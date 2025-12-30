// Supabase Configuration
const SUPABASE_URL = 'https://crmgocruuhldfujfdech.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNybWdvY3J1dWhsZGZ1amZkZWNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwNzQ1MTQsImV4cCI6MjA4MjY1MDUxNH0.ZdvfbMLdt9mdSIePlwjST9SkeWB2Ih4aHK6Egv0FfN4';

let supabaseClient;

// App State
const state = {
    allPoles: [],      // All loaded data
    visiblePoles: [],  // Filtered data for map
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

// --- Helper: Generate Color from String ---
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
            return; // Stop if no lib
        }
    } catch (e) {
        console.error('Init error', e);
        return;
    }

    // 2. Setup Events
    setupEventListeners();

    // 3. Auto Login Check & Load
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
            // When zone changes, we reset line filters because the lines are different
            state.hiddenLines.clear();
            updateLineList();
            applyFilters();
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
    if (state.map) return; // already initialized

    state.map = L.map('map').setView(CONFIG.defaultCenter, CONFIG.defaultZoom);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(state.map);

    // Initialize Marker Cluster Group
    state.clusterLayer = L.markerClusterGroup({
        disableClusteringAtZoom: 18, // Stop clustering at high zoom
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

        // Debug Log (Silent)
        if (data.length > 0) {
            console.log('DB First Row:', data[0]);
        } else {
            console.warn('DB Data is empty');
        }

        // 1. Data Mapping
        const mappedData = data.map(row => {
            // Zone Mapping: User specified '구역(4본부)' > '구역'
            let zoneVal = row['구역(4본부)'];
            if (!zoneVal) zoneVal = row['구역'];
            if (!zoneVal) zoneVal = 'Unknown';

            // Line Mapping: '선로명' (Priority) > '회선명' (Safety)
            let lineVal = row['선로명'];
            if (!lineVal) lineVal = row['회선명'];
            if (!lineVal) lineVal = 'Unknown';

            return {
                id: row['전산화번호'] || '',
                lat: parseFloat(row['위도']),
                lng: parseFloat(row['경도']),
                line: lineVal,
                zone: zoneVal,
                info: row // Keep original for popup
            };
        });

        // 2. Filter Invalid Coords
        state.allPoles = mappedData.filter(p => !isNaN(p.lat) && !isNaN(p.lng) && p.lat !== 0 && p.lng !== 0);

        console.log(`Loaded ${state.allPoles.length} valid poles.`);

        // 3. UI Setup
        populateZoneSelect();

        // 4. Auto Select First Zone
        const select = document.getElementById('zone-select');
        if (select && select.options.length > 0) {
            // Ensure we pick a real zone if possible
            state.selectedZone = select.value;
            // Trigger updates
            updateLineList();
            applyFilters();
        }

    } catch (err) {
        console.error('Data Load Error:', err);
        alert('데이터 로드 실패. 콘솔을 확인하세요.');
    }
}

function populateZoneSelect() {
    // Extract unique zones
    const zones = new Set(state.allPoles.map(p => p.zone).filter(z => z && z !== 'Unknown'));
    const sortedZones = Array.from(zones).sort();

    const select = document.getElementById('zone-select');
    if (!select) return;

    select.innerHTML = ''; // Request says dropdown, maybe implicit 'All'?
    // User Request: '1구역', '2구역' 등을 표시해줘. 
    // And "앱 시작 시 자동으로 첫 번째 구역이 선택되고" -> implies no 'All' or 'All' is not default.
    // I will add 'All Zones' as first option just in case, but then select sortedZones[0].
    // Actually user said "Select first zone", usually meaning a specific zone.

    // Let's add specific zones first.
    sortedZones.forEach(z => {
        const opt = document.createElement('option');
        opt.value = z;
        opt.textContent = z;
        select.appendChild(opt);
    });

    // Select first one if exists
    if (sortedZones.length > 0) {
        select.value = sortedZones[0];
    }
}

function updateLineList(searchTerm = '') {
    const listContainer = document.getElementById('line-list');
    if (!listContainer) return;

    // Filter poles by CURRENT Zone
    const zonePoles = state.allPoles.filter(p => p.zone === state.selectedZone);

    // Get unique lines in this zone
    const lines = new Set(zonePoles.map(p => p.line).filter(l => l));
    const sortedLines = Array.from(lines).sort();

    // Filter by search term
    const visibleLines = sortedLines.filter(l => l.toLowerCase().includes(searchTerm.toLowerCase()));

    listContainer.innerHTML = '';

    if (visibleLines.length === 0) {
        listContainer.innerHTML = '<div style="padding:10px; color:#aaa;">No lines found</div>';
        return;
    }

    visibleLines.forEach(line => {
        const item = document.createElement('div');
        item.className = 'line-item';

        const color = getLineColor(line);

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = !state.hiddenLines.has(line);
        checkbox.style.accentColor = color;

        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                state.hiddenLines.delete(line);
            } else {
                state.hiddenLines.add(line);
            }
            applyFilters();
        });

        // Color dot
        const colorDot = document.createElement('span');
        colorDot.style.display = 'inline-block';
        colorDot.style.width = '12px';
        colorDot.style.height = '12px';
        colorDot.style.borderRadius = '50%';
        colorDot.style.backgroundColor = color;
        colorDot.style.marginRight = '8px';
        colorDot.style.marginLeft = '5px';

        const label = document.createElement('span');
        label.textContent = line;

        item.appendChild(checkbox);
        item.appendChild(colorDot);
        item.appendChild(label);

        item.addEventListener('click', (e) => {
            if (e.target !== checkbox) {
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change'));
            }
        });

        listContainer.appendChild(item);
    });
}

function applyFilters() {
    // Filter visible poles
    state.visiblePoles = state.allPoles.filter(p => {
        // Zone check
        if (p.zone !== state.selectedZone) return false;
        // Hidden line check
        if (state.hiddenLines.has(p.line)) return false;
        return true;
    });

    renderMarkers();
    updateStats();
}

function renderMarkers() {
    if (!state.clusterLayer) return;
    state.clusterLayer.clearLayers();

    const markers = state.visiblePoles.map(p => {
        const color = getLineColor(p.line);
        const info = p.info || {};

        // Popup Content
        const popupContent = `
            <div style="min-width:200px; font-size:13px;">
                <Strong style="color:${color}; font-size:14px;">${p.line}</strong><br>
                <hr style="margin:5px 0; border:0; border-top:1px solid #ddd;">
                <b>ID:</b> ${p.id}<br>
                <b>회선:</b> ${info['회선명'] || '-'}<br>
                <b>주소:</b> ${info['인근주소(참고자료)'] || '-'}<br>
                <b>구역:</b> ${p.zone}
            </div>
        `;

        // Circle Marker
        const marker = L.circleMarker([p.lat, p.lng], {
            radius: 7,
            fillColor: color,
            color: '#fff',
            weight: 1,
            opacity: 1,
            fillOpacity: 0.9
        });

        marker.bindPopup(popupContent);
        return marker;
    });

    state.clusterLayer.addLayers(markers);

    // Fit bounds
    if (markers.length > 0 && state.map) {
        state.map.fitBounds(state.clusterLayer.getBounds(), { padding: [50, 50] });
    }
}

function updateStats() {
    const vc = document.getElementById('visible-count');
    if (vc) vc.textContent = state.visiblePoles.length.toLocaleString();
}

function downloadCSV() {
    if (state.visiblePoles.length === 0) {
        return;
    }

    // Columns: Zone, Line, ID, Lat, Lng
    const headers = ['구역', '선로명', '전산화번호', '위도', '경도', '주소'];
    const rows = state.visiblePoles.map(p => {
        const info = p.info || {};
        return [
            p.zone,
            p.line,
            p.id,
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
    link.setAttribute('download', 'pole_data_export.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
