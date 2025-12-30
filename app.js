// Supabase Configuration
const SUPABASE_URL = 'https://crmgocruuhldfujfdech.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNybWdvY3J1dWhsZGZ1amZkZWNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwNzQ1MTQsImV4cCI6MjA4MjY1MDUxNH0.ZdvfbMLdt9mdSIePlwjST9SkeWB2Ih4aHK6Egv0FfN4';

let supabaseClient;

// App State
const state = {
    allPoles: [],      // All data from DB
    visiblePoles: [],  // Filtered for map
    selectedZone: '',
    hiddenLines: new Set(),
    map: null,
    clusterLayer: null,
    lineColors: {}     // Color cache
};

const CONFIG = {
    defaultCenter: [37.45, 126.85],
    defaultZoom: 13
};

// --- Utils: Color Generation ---
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

// --- Main Init ---
document.addEventListener('DOMContentLoaded', async () => {
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

    setupEventListeners();
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

// --- Event Listeners ---
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
            state.hiddenLines.clear(); // Reset line filters
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
    if (state.map) return;

    state.map = L.map('map').setView(CONFIG.defaultCenter, CONFIG.defaultZoom);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(state.map);

    // Marker Cluster
    state.clusterLayer = L.markerClusterGroup({
        disableClusteringAtZoom: 18,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false
    });

    state.map.addLayer(state.clusterLayer);
}

// --- Data Logic ---
async function loadData() {
    if (!supabaseClient) return;

    try {
        const { data, error } = await supabaseClient.from('poles').select('*');
        if (error) throw error;

        // Debug: Log raw data to confirm columns
        if (data.length > 0) {
            console.log('Load Data Success. First Row:', data[0]);
        }

        // 1. Precise Mapping (Based on User's DB Screenshot)
        const mappedData = data.map(row => {
            // Zone: '구역(4등분)'
            const zoneVal = row['구역(4등분)'] || 'Unknown';

            // Line: '선로명'
            const lineVal = row['선로명'] || 'Unknown';

            return {
                id: row['전산화번호'] || '',
                lat: parseFloat(row['위도']),
                lng: parseFloat(row['경도']),
                zone: zoneVal,
                line: lineVal,
                // Extra info (Circuit name, etc)
                circuit: row['회선명'] || '',
                info: row
            };
        });

        // 2. Filter Valid Coords
        state.allPoles = mappedData.filter(p =>
            !isNaN(p.lat) && !isNaN(p.lng) && p.lat !== 0 && p.lng !== 0
        );

        console.log(`Valid Poles Parsed: ${state.allPoles.length}`);

        // 3. UI Init
        populateZoneSelect();

        // 4. Auto-select first zone to show data immediately
        const select = document.getElementById('zone-select');
        if (select && select.options.length > 0) {
            state.selectedZone = select.value;
            updateLineList();
            applyFilters();
        }

    } catch (err) {
        console.error('Data Load Error:', err);
        alert('데이터 로드 실패 (콘솔 확인)');
    }
}

function populateZoneSelect() {
    // Get unique zones
    const zones = new Set(state.allPoles.map(p => p.zone).filter(z => z && z !== 'Unknown'));
    const sortedZones = Array.from(zones).sort();

    const select = document.getElementById('zone-select');
    if (!select) return;

    select.innerHTML = '';

    sortedZones.forEach(z => {
        const opt = document.createElement('option');
        opt.value = z;
        opt.textContent = z;
        select.appendChild(opt);
    });

    // Default select first
    if (sortedZones.length > 0) {
        select.value = sortedZones[0];
    }
}

function updateLineList(searchTerm = '') {
    const listContainer = document.getElementById('line-list');
    if (!listContainer) return;

    // Filter poles by CURRENT Zone first
    const zonePoles = state.allPoles.filter(p => p.zone === state.selectedZone);

    // Get unique lines within this zone
    const lines = new Set(zonePoles.map(p => p.line).filter(l => l && l !== 'Unknown'));
    const sortedLines = Array.from(lines).sort();

    // Search filter
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

        // Color indicator
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
    state.visiblePoles = state.allPoles.filter(p => {
        // Zone Match
        if (p.zone !== state.selectedZone) return false;
        // Hidden Line Check
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

        // Popup
        const popupContent = `
            <div style="font-family:'Inter', sans-serif; font-size:13px; min-width:180px;">
                <h3 style="margin:0 0 8px 0; color:${color}; border-bottom:1px solid #ddd; padding-bottom:5px;">
                    ${p.line}
                </h3>
                <div style="line-height:1.6;">
                    <b>ID:</b> ${p.id}<br>
                    <b>회선명:</b> ${p.circuit}<br>
                    <b>구역:</b> ${p.zone}<br>
                    <b>주소:</b> ${info['인근주소(참고자료)'] || '-'}
                </div>
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

    if (markers.length > 0 && state.map) {
        state.map.fitBounds(state.clusterLayer.getBounds(), { padding: [50, 50] });
    }
}

function updateStats() {
    const vc = document.getElementById('visible-count');
    const cc = document.getElementById('cluster-count');
    if (vc) vc.textContent = state.visiblePoles.length.toLocaleString();
    if (cc) cc.textContent = '-'; // Calculation complex with MarkerCluster, simplify for now
}

function downloadCSV() {
    if (state.visiblePoles.length === 0) return;

    const headers = ['구역', '선로명', '회선명', '전산화번호', '위도', '경도', '주소'];
    const rows = state.visiblePoles.map(p => {
        const info = p.info || {};
        return [
            p.zone,
            p.line,
            p.circuit,
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
    link.setAttribute('download', 'poles_export.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
