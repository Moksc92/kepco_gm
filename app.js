// Supabase Configuration
const SUPABASE_URL = 'https://crmgocruuhldfujfdech.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNybWdvY3J1dWhsZGZ1amZkZWNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwNzQ1MTQsImV4cCI6MjA4MjY1MDUxNH0.ZdvfbMLdt9mdSIePlwjST9SkeWB2Ih4aHK6Egv0FfN4';

let supabaseClient;

// App State
const state = {
    allPoles: [],      // All loaded data
    visiblePoles: [],  // Filtered data
    selectedZone: '',
    hiddenLines: new Set(),
    map: null,
    clusterLayer: null,
    lineColors: {}     // Cache for line colors
};

// Configuration
const CONFIG = {
    defaultCenter: [37.45, 126.85],
    defaultZoom: 13
};

// --- Color Generator ---
function stringToColor(str) {
    if (!str) return '#666666';
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return '#' + '00000'.substring(0, 6 - c.length) + c;
}

function getLineColor(lineName) {
    if (!state.lineColors[lineName]) {
        // Generate a vibrant color for the line
        state.lineColors[lineName] = stringToColor(lineName);
    }
    return state.lineColors[lineName];
}

// --- Main Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialize Supabase
    try {
        if (typeof supabase !== 'undefined' && supabase.createClient) {
            supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        } else {
            console.error('Supabase lib not found');
            return;
        }
    } catch (e) {
        console.error('Init error', e);
        return;
    }

    // 2. Setup Events
    setupEventListeners();

    // 3. Check Session & Start
    await checkSession();
});

async function checkSession() {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) {
            showApp();
        } else {
            document.getElementById('app').style.display = 'none';
            document.getElementById('login-modal').style.display = 'flex';
        }
    } catch (e) {
        console.error("Session check failed", e);
    }
}

function setupEventListeners() {
    // Login
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', handleLogin);
    }

    // Zone Select
    const zoneSelect = document.getElementById('zone-select');
    if (zoneSelect) {
        zoneSelect.addEventListener('change', (e) => {
            state.selectedZone = e.target.value;
            state.hiddenLines.clear(); // Clear line filters when zone changes
            updateLineList(); // Refresh checkboxes for new zone
            applyFilters();   // Update map
        });
    }

    // Line Search
    const lineSearch = document.getElementById('line-search');
    if (lineSearch) {
        lineSearch.addEventListener('input', (e) => {
            updateLineList(e.target.value);
        });
    }

    // Download
    const btnDownload = document.getElementById('btn-download');
    if (btnDownload) {
        btnDownload.addEventListener('click', downloadCSV);
    }

    // Logout
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            if (supabaseClient) await supabaseClient.auth.signOut();
            window.location.reload();
        });
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    if (!email || !password) {
        alert('이메일과 비밀번호를 입력하세요.');
        return;
    }

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
        alert('로그인 실패: ' + error.message);
    } else {
        showApp();
    }
}

async function showApp() {
    document.getElementById('login-modal').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    initMap();
    await loadData();
}

// --- Map Logic ---
function initMap() {
    if (state.map) return;

    state.map = L.map('map').setView(CONFIG.defaultCenter, CONFIG.defaultZoom);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(state.map);

    // Initialize Marker Cluster Group
    // We use a custom iconCreateFunction if we want to style clusters, 
    // but default styling is usually fine for "cluster" concept.
    // For single markers, we will customize.
    state.clusterLayer = L.markerClusterGroup({
        disableClusteringAtZoom: 18,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false
    });

    state.map.addLayer(state.clusterLayer);
}

// --- Data Loading & Processing ---
async function loadData() {
    if (!supabaseClient) return;

    try {
        const { data, error } = await supabaseClient.from('poles').select('*');
        if (error) throw error;

        // Debug Log
        if (data.length > 0) {
            console.log('Sample Data Row:', data[0]);
        }

        // 1. Precise Mapping
        const mapped = data.map(row => {
            // Zone Mapping Strategy: '구역(4본부)' > '구역' > 'Unknown'
            let zoneVal = row['구역(4본부)'];
            if (!zoneVal) zoneVal = row['구역'];

            // If still empty, try legacy names just in case, or default
            if (!zoneVal) zoneVal = 'Unknown';

            return {
                id: row['전산화번호'],
                lat: parseFloat(row['위도']),
                lng: parseFloat(row['경도']),
                // IMPORTANT: Line = '선로명'
                line: row['선로명'] || 'Unknown',
                zone: zoneVal,
                // Extra info
                info: row
            };
        });

        // 2. Filter Valid Coords
        state.allPoles = mapped.filter(p =>
            !isNaN(p.lat) && !isNaN(p.lng) && p.lat !== 0 && p.lng !== 0
        );

        // 3. Initial Setup
        populateZoneSelect();

        // 4. Auto-select first zone
        const zoneSelect = document.getElementById('zone-select');
        if (zoneSelect && zoneSelect.options.length > 0) {
            // Select the first real option (not 'All' if we want to force specific)
            // User requested: "앱 시작 시 자동으로 첫 번째 구역이 선택되고"
            // Usually options[0] is often "All" or the first zone.
            // Let's check populateZoneSelect logic.
            state.selectedZone = zoneSelect.value;
            updateLineList();
            applyFilters();
        }

    } catch (err) {
        console.error('Data Load Error:', err);
        alert('데이터 로드 중 오류가 발생했습니다.');
    }
}

// --- UI Population ---
function populateZoneSelect() {
    const zones = new Set(state.allPoles.map(p => p.zone).filter(z => z && z !== 'Unknown'));
    const sortedZones = Array.from(zones).sort();

    const select = document.getElementById('zone-select');
    if (!select) return;

    select.innerHTML = '';

    // Add zones
    sortedZones.forEach(z => {
        const opt = document.createElement('option');
        opt.value = z;
        opt.textContent = z;
        select.appendChild(opt);
    });

    // If we have zones, ensure one is selected
    if (sortedZones.length > 0) {
        select.value = sortedZones[0];
    }
}

function updateLineList(searchTerm = '') {
    const listContainer = document.getElementById('line-list');
    if (!listContainer) return;

    // Filter poles by CURRENT selected zone to find available lines
    const zonePoles = state.allPoles.filter(p => p.zone === state.selectedZone);
    const lines = new Set(zonePoles.map(p => p.line).filter(l => l));
    const sortedLines = Array.from(lines).sort();

    // Filter by search term
    const visibleLines = sortedLines.filter(l => l.toLowerCase().includes(searchTerm.toLowerCase()));

    listContainer.innerHTML = '';

    visibleLines.forEach(line => {
        const item = document.createElement('div');
        item.className = 'line-item';

        // Color indicator
        const color = getLineColor(line);

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = !state.hiddenLines.has(line);
        checkbox.className = 'line-checkbox';

        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                state.hiddenLines.delete(line);
            } else {
                state.hiddenLines.add(line);
            }
            applyFilters();
        });

        const label = document.createElement('span');
        label.textContent = line;
        label.style.marginLeft = '8px';

        const colorDot = document.createElement('span');
        colorDot.style.display = 'inline-block';
        colorDot.style.width = '10px';
        colorDot.style.height = '10px';
        colorDot.style.borderRadius = '50%';
        colorDot.style.backgroundColor = color;
        colorDot.style.marginRight = '8px';

        item.appendChild(checkbox);
        item.appendChild(colorDot);
        item.appendChild(label);

        // Click item to toggle
        item.addEventListener('click', (e) => {
            if (e.target !== checkbox) {
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change'));
            }
        });

        listContainer.appendChild(item);
    });
}

// --- Filtering & Rendering ---
function applyFilters() {
    // Filter logic
    state.visiblePoles = state.allPoles.filter(p => {
        // 1. Zone Filter
        if (p.zone !== state.selectedZone) return false;
        // 2. Line Filter
        if (state.hiddenLines.has(p.line)) return false;

        return true;
    });

    renderMap();
    updateStats();
}

function renderMap() {
    if (!state.clusterLayer) return;

    state.clusterLayer.clearLayers();

    const markers = state.visiblePoles.map(p => {
        const color = getLineColor(p.line);

        // Use CircleMarker for better performance and easy coloring
        const marker = L.circleMarker([p.lat, p.lng], {
            radius: 8,
            fillColor: color,
            color: '#fff',
            weight: 1,
            opacity: 1,
            fillOpacity: 0.8
        });

        const info = p.info || {};
        const popupContent = `
            <div style="font-family: 'Inter', sans-serif; font-size: 13px;">
                <h3 style="margin:0 0 8px 0; color:${color}; border-bottom:1px solid #eee; padding-bottom:5px;">
                    ${p.line}
                </h3>
                <div style="display:grid; grid-template-columns: 80px 1fr; gap: 4px;">
                    <div style="color:#666;">전산화번호</div><div>${p.id}</div>
                    <div style="color:#666;">회선명</div><div>${info['회선명'] || '-'}</div>
                    <div style="color:#666;">선로번호</div><div>${info['선로번호'] || '-'}</div>
                    <div style="color:#666;">구역</div><div>${p.zone}</div>
                    <div style="color:#666;">주소</div><div>${info['인근주소(참고자료)'] || info['addr'] || '-'}</div>
                </div>
            </div>
        `;

        marker.bindPopup(popupContent);
        return marker;
    });

    state.clusterLayer.addLayers(markers);

    // Fit bounds if we have points
    if (markers.length > 0) { // Removed initialBoundsSet check to auto-fit on filter change
        state.map.fitBounds(state.clusterLayer.getBounds(), { padding: [50, 50] });
    }
}

function updateStats() {
    const vc = document.getElementById('visible-count');
    // Using clusterLayer to get cluster count is tricky because it depends on zoom.
    // We can just show total visible poles and maybe "Groups" if desired.
    // But the user UI has "Clusters".
    // Leaflet.markerCluster doesn't give a simple "current cluster count" easily without traversing.
    // Let's just show Visible Poles count for now accurately.
    // And for Clusters, we can get the getLayers() count, but that's individual markers.
    // The previous logic calculated custom clusters. 
    // Let's just update Total Poles for now.

    if (vc) vc.textContent = state.visiblePoles.length.toLocaleString();

    // Attempt to count clusters (approximation from visible layers in the group, usually not directly exposed efficiently).
    // We'll leave Cluster Count as is or set to '-' to avoid confusion if we can't get it easily.
    // Or we keep the UI element but update it with something else? 
    // Let's try to just update visible poles.
}

// --- CSV Download ---
function downloadCSV() {
    if (state.visiblePoles.length === 0) {
        return;
    }

    const headers = ['구역', '선로명', '회선명', '전산화번호', '선로번호', '위도', '경도', '주소'];
    const rows = state.visiblePoles.map(p => {
        const info = p.info || {};
        return [
            p.zone,
            p.line,
            info['회선명'] || '',
            p.id,
            info['선로번호'] || '',
            p.lat,
            p.lng,
            info['인근주소(참고자료)'] || ''
        ];
    });

    const BOM = '\uFEFF';
    let csvContent = BOM + headers.join(',') + '\n';

    rows.forEach(row => {
        const safeRow = row.map(item => {
            const str = String(item || '');
            return str.includes(',') ? `"${str}"` : str;
        });
        csvContent += safeRow.join(',') + '\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `poles_${state.selectedZone}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
