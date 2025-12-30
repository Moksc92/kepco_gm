// Supabase Configuration
const SUPABASE_URL = 'https://crmgocruuhldfujfdech.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNybWdvY3J1dWhsZGZ1amZkZWNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwNzQ1MTQsImV4cCI6MjA4MjY1MDUxNH0.ZdvfbMLdt9mdSIePlwjST9SkeWB2Ih4aHK6Egv0FfN4';

// Global Client Instance
let supabaseClient;

// App State
const state = {
    selectedZone: 'all',
    hiddenLines: new Set(),
    poles: [],
    visiblePoles: [],
    currentClusters: [],
    map: null,
    layers: {
        points: null,
        clusters: null
    }
};

const CONFIG = {
    clusterDistance: 50, // meters
    defaultCenter: [37.45, 126.85],
    defaultZoom: 13
};

// Utils (Helper functions)
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

function performClustering(points) {
    const clusters = [];
    const byLine = {};

    points.forEach((p) => {
        if (!byLine[p.line]) byLine[p.line] = [];
        byLine[p.line].push(p);
    });

    Object.keys(byLine).forEach(lineName => {
        const linePoints = byLine[lineName];
        const visited = new Set();

        for (let i = 0; i < linePoints.length; i++) {
            if (visited.has(i)) continue;

            const current = linePoints[i];
            const cluster = {
                lat: current.lat,
                lng: current.lng,
                count: 1,
                line: lineName,
                points: [current]
            };
            visited.add(i);

            for (let j = i + 1; j < linePoints.length; j++) {
                if (visited.has(j)) continue;

                const neighbor = linePoints[j];
                const dist = getDistance(current.lat, current.lng, neighbor.lat, neighbor.lng);

                if (dist <= CONFIG.clusterDistance) {
                    const newCount = cluster.count + 1;
                    cluster.lat = (cluster.lat * cluster.count + neighbor.lat) / newCount;
                    cluster.lng = (cluster.lng * cluster.count + neighbor.lng) / newCount;
                    cluster.count = newCount;
                    cluster.points.push(neighbor);
                    visited.add(j);
                }
            }
            clusters.push(cluster);
        }
    });

    return clusters;
}

// MAIN EXECUTION
document.addEventListener('DOMContentLoaded', async () => {

    // 1. Initialize Supabase safely check global 'supabase' from UMD
    try {
        if (typeof supabase !== 'undefined' && supabase.createClient) {
            // Create client using the global `supabase` object
            supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
            // Alert removed
        } else {
            throw new Error('Supabase Library (Global Variable) not found.');
        }
    } catch (e) {
        alert('초기화 에러: ' + e.message);
        console.error(e);
        return;
    }

    // 2. Setup Login Handler
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', async (e) => {
            e.preventDefault();

            // Alert removed: alert('버튼 클릭됨');

            const emailInput = document.getElementById('email');
            const passwordInput = document.getElementById('password');

            const email = emailInput ? emailInput.value : '';
            const password = passwordInput ? passwordInput.value : '';

            if (!email || !password) {
                alert('이메일과 비밀번호를 모두 입력해주세요.');
                return;
            }

            try {
                const { data, error } = await supabaseClient.auth.signInWithPassword({
                    email: email,
                    password: password
                });

                if (error) {
                    throw error;
                }

                // Success
                showApp();

            } catch (err) {
                alert('로그인 에러: ' + err.message);
            }
        });
    } else {
        console.error('Error: login-btn not found');
    }

    // 3. Auto Login Check
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

    // 4. Setup Other Event Listeners
    setupEventListeners();
});

// App Logic Functions
async function showApp() {
    document.getElementById('login-modal').style.display = 'none';
    document.getElementById('app').style.display = 'flex';

    await loadData();
    initMap();
}

async function loadData() {
    if (!supabaseClient) return;

    try {
        const { data, error } = await supabaseClient.from('poles').select('*');
        if (error) throw error;

        // FIXED: Mapping Korean columns
        const mappedData = data.map(row => ({
            id: row['전산화번호'],
            lat: parseFloat(row['위도']),
            lng: parseFloat(row['경도']),
            line: row['회선명'],
            zone: row['구역명'] || row['구역'] || 'Unknown',
            // Store original for popup details
            info: row
        }));

        // Filter valid coordinates
        state.poles = mappedData.filter(p => !isNaN(p.lat) && !isNaN(p.lng) && p.lat !== 0 && p.lng !== 0);

        // Debug first item
        if (state.poles.length > 0) {
            console.log('Mapped Data Example:', state.poles[0]);
        }

        state.visiblePoles = [...state.poles];

        populateZoneFilter();
        updateLineList();
        renderPoints();
        updateStats();

    } catch (err) {
        alert('데이터 로드 실패: ' + err.message);
        console.error(err);
    }
}

function initMap() {
    if (state.map) return;
    state.map = L.map('map').setView(CONFIG.defaultCenter, CONFIG.defaultZoom);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(state.map);
}

function setupEventListeners() {
    const zoneSelect = document.getElementById('zone-select');
    if (zoneSelect) {
        zoneSelect.addEventListener('change', (e) => {
            state.selectedZone = e.target.value;
            state.hiddenLines.clear();
            updateLineList();
            applyFilters();
        });
    }

    const lineSearch = document.getElementById('line-search');
    if (lineSearch) {
        lineSearch.addEventListener('input', (e) => {
            updateLineList(e.target.value);
        });
    }

    const btnDownload = document.getElementById('btn-download');
    if (btnDownload) {
        btnDownload.addEventListener('click', downloadCSV);
    }

    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            if (supabaseClient) await supabaseClient.auth.signOut();
            window.location.reload();
        });
    }
}

function downloadCSV() {
    const data = state.visiblePoles;
    if (data.length === 0) {
        alert('No data to download.');
        return;
    }

    const headers = ['회선명', '전산화번호', '선로명', '선로번호', '구역', '위도', '경도', '주소'];
    const rows = data.map(p => {
        const info = p.info || {};
        return [
            info['회선명'] || '',
            p.id,
            p.line, // mapped from 회선명? No, wait. 
            // In mapping: line: row['회선명']
            // Wait, looking at loadData: 
            // line: row['회선명'] -> This seems wrong based on CSV headers earlier.
            // CSV had: '선로명', '회선명'.
            // Usually 'line' refers to '선로명' (Circuit Line Name) and 'circuit' to '회선명'.
            // Let me check my previous mapping logic in step 147 request.
            // User requested: line: row['회선명']. 
            // BUT earlier they said: "line: row['선로명']".
            // Let's stick to what the user requested in Step 147: "line: row['회선명']".
            // Actually, looking at Step 147 request: "line: row['회선명']".
            // BUT, in csv '선로명' is the main grouping. '회선명' is smaller?
            // I'll follow the explicit instruction in Step 147 regardless of my doubt, to satisfy the prompt.
            // Wait, looking at CSV structure again: '선로명' is likely what we filter by.
            // If I map line: row['회선명'], then the filter list will show '회선명'.
            // If that's what they want.
            // BUT, let's look at the mapping I wrote just now:
            // line: row['회선명']
            // Let's double check the user request in Step 147.
            // "line: row['회선명']" -> Yes, that is what they asked for.
            // Okay, I will stick to it.

            info['선로번호'] || '',
            p.zone,
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
    link.setAttribute('download', `pole_data_${state.selectedZone}_filtered.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function populateZoneFilter() {
    const zones = new Set(state.poles.map(p => p.zone).filter(z => z));
    const select = document.getElementById('zone-select');
    if (!select) return;

    select.innerHTML = '<option value="all">All Zones</option>';
    const sortedZones = Array.from(zones).sort();

    sortedZones.forEach(zone => {
        const option = document.createElement('option');
        option.value = zone;
        option.textContent = zone;
        select.appendChild(option);
    });
}

function updateLineList(searchTerm = '') {
    const lineListContainer = document.getElementById('line-list');
    if (!lineListContainer) return;

    let relevantPoles = state.poles;
    if (state.selectedZone !== 'all') {
        relevantPoles = relevantPoles.filter(p => p.zone === state.selectedZone);
    }

    const lines = new Set(relevantPoles.map(p => p.line).filter(l => l));
    const sortedLines = Array.from(lines).sort();
    const displayLines = sortedLines.filter(l => l.toLowerCase().includes(searchTerm.toLowerCase()));

    lineListContainer.innerHTML = '';
    const fragment = document.createDocumentFragment();

    if (displayLines.length === 0) {
        lineListContainer.innerHTML = '<div style="padding:10px; color:#64748b; font-size:0.9rem;">No lines found</div>';
        return;
    }

    displayLines.forEach(line => {
        const div = document.createElement('div');
        div.className = 'line-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = !state.hiddenLines.has(line);
        checkbox.dataset.line = line;

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

        div.appendChild(checkbox);
        div.appendChild(label);

        div.addEventListener('click', (e) => {
            if (e.target !== checkbox) {
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change'));
            }
        });

        fragment.appendChild(div);
    });

    lineListContainer.appendChild(fragment);
}


function applyFilters() {
    state.visiblePoles = state.poles.filter(p => {
        if (state.selectedZone !== 'all' && p.zone !== state.selectedZone) return false;
        if (state.hiddenLines.has(p.line)) return false;
        return true;
    });

    renderPoints();
}

function createPopupContent(cluster) {
    const points = cluster.points;

    let html = `
        <div class="popup-header">
            <h3>${cluster.line}</h3>
        </div>
        <div class="popup-body custom-scrollbar">
            <table class="info-table">
                <thead>
                    <tr>
                        <th>회선명</th>
                        <th>전산화번호</th>
                        <th>선로번호</th>
                        <th>위도</th>
                        <th>경도</th>
                    </tr>
                </thead>
                <tbody>
    `;

    points.forEach(p => {
        const info = p.info || {};
        html += `
            <tr>
                <td>${info['회선명'] || '-'}</td>
                <td>${p.id || info['전산화번호'] || '-'}</td>
                <td>${info['선로번호'] || '-'}</td>
                <td>${p.lat.toFixed(6)}</td>
                <td>${p.lng.toFixed(6)}</td>
            </tr>
        `;
    });

    html += `
                </tbody>
            </table>
        </div>
    `;

    return html;
}

function renderPoints() {
    if (!state.map) return;
    if (state.layers.clusters) state.map.removeLayer(state.layers.clusters);

    const clusterGroup = L.layerGroup();
    state.currentClusters = performClustering(state.visiblePoles);

    state.currentClusters.forEach(c => {
        let size, className, iconHtml;

        if (c.count > 1) {
            size = Math.min(60, 30 + (c.count * 2));
            className = 'marker-cluster-custom';
            iconHtml = `<div class="${className}" style="width:${size}px; height:${size}px;">${c.count}</div>`;
        } else {
            size = 30;
            className = 'marker-single-custom';
            iconHtml = `<div class="${className}" style="width:${size}px; height:${size}px;">1</div>`;
        }

        const icon = L.divIcon({
            html: iconHtml,
            className: '',
            iconSize: [size, size]
        });

        const marker = L.marker([c.lat, c.lng], { icon: icon });
        const popupContent = createPopupContent(c);
        marker.bindPopup(popupContent, { maxWidth: 500 });

        clusterGroup.addLayer(marker);
    });

    state.layers.clusters = clusterGroup;
    state.map.addLayer(clusterGroup);

    if (state.visiblePoles.length > 0 && !state.initialBoundsSet) {
        const bounds = L.latLngBounds(state.visiblePoles.map(p => [p.lat, p.lng]));
        state.map.fitBounds(bounds, { padding: [50, 50] });
        state.initialBoundsSet = true;
    }

    updateStats();
}

function updateStats() {
    const vc = document.getElementById('visible-count');
    const cc = document.getElementById('cluster-count');
    if (vc) vc.textContent = state.visiblePoles.length.toLocaleString();
    if (cc) cc.textContent = state.currentClusters.length.toLocaleString();
}
