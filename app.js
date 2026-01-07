// Supabase Configuration
const SUPABASE_URL = 'https://crmgocruuhldfujfdech.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNybWdvY3J1dWhsZGZ1amZkZWNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwNzQ1MTQsImV4cCI6MjA4MjY1MDUxNH0.ZdvfbMLdt9mdSIePlwjST9SkeWB2Ih4aHK6Egv0FfN4';

// Initialize Supabase
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// State
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

// Utils
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

// App Initialization
document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
});

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const btn = e.target.querySelector('button');

    // Loading State
    btn.disabled = true;
    btn.textContent = 'Logging in...';

    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: email,
        password: password
    });

    if (error) {
        alert("로그인 실패: 이메일이나 비밀번호를 확인하세요.");
        btn.disabled = false;
        btn.textContent = 'Login';
        return;
    }

    // Success
    document.getElementById('login-modal').classList.add('hidden');
    await loadData();
    initMap();
}

async function handleLogout() {
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
        console.error('Logout error:', error);
    }
    // Simple reload to reset everything and show login screen
    window.location.reload();
}

async function loadData() {
    // 넉넉하게 가져오기 위해 limit 제거 혹은 조정 가능
    const { data, error } = await supabaseClient
        .from('poles')
        .select('*');

    if (error) {
        console.error('Error fetching data:', error);
        alert('데이터를 가져오는 중 오류가 발생했습니다.');
        return;
    }

    // ★ [핵심 수정 1] 구역(4등분) 컬럼 매핑 수정
    // 괄호가 들어간 컬럼명은 점(.) 대신 대괄호['']를 써야 합니다.
    state.poles = data.map(item => ({
        lat: item.lat || item.위도 || 0,
        lng: item.lng || item.경도 || 0,
        // 여기가 핵심입니다: item['구역(4등분)']
        zone: item['구역(4등분)'] || item.zone || item.구역 || 'Unknown',
        line: item.line || item.선로명 || 'Unknown',
        id: item.pole_id || item.전산화번호 || '',
        addr: item.address || item.주소 || item['인근주소(참고자료)'] || '',
        circuit: item.circuit || item.회선명 || '',
        line_num: item.line_num || item.선로번호 || ''
    }));

    // 유효한 좌표만 필터링
    state.poles = state.poles.filter(p => p.lat !== 0 && p.lng !== 0);
    state.visiblePoles = [...state.poles];
}

function initMap() {
    state.map = L.map('map').setView(CONFIG.defaultCenter, CONFIG.defaultZoom);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(state.map);

    populateZoneFilter();
    updateLineList();
    renderPoints();

    setupAppEventListeners();

    // 맵 사이즈 강제 재조정 (UI 깨짐 방지)
    setTimeout(() => {
        state.map.invalidateSize();
    }, 200);
}

function setupAppEventListeners() {
    document.getElementById('zone-select').addEventListener('change', (e) => {
        state.selectedZone = e.target.value;
        state.hiddenLines.clear();
        updateLineList();
        applyFilters();
    });

    document.getElementById('line-search').addEventListener('input', (e) => {
        updateLineList(e.target.value);
    });

    const downloadBtn = document.getElementById('btn-download');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', downloadCSV);
    }

    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
}

function downloadCSV() {
    // Generate data from current clusters to ensure 'Clustering Address' is correct
    const clusters = state.currentClusters;
    if (clusters.length === 0) {
        alert('No data to download.');
        return;
    }

    const headers = ['클러스터링주소', '회선명', '전산화번호', '선로명', '선로번호', '구역', '위도', '경도', '주소'];
    const rows = [];

    clusters.forEach(cluster => {
        // Representative address for the cluster
        const clusterAddress = cluster.points.length > 0 ? (cluster.points[0].addr || '주소 없음') : '정보 없음';

        cluster.points.forEach(p => {
            rows.push([
                clusterAddress, // New Column
                p.circuit,
                p.id,
                p.line,
                p.line_num,
                p.zone,
                p.lat,
                p.lng,
                p.addr
            ]);
        });
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
    // Unknown 값은 필터 목록에서 제외
    const zones = new Set(state.poles.map(p => p.zone).filter(z => z && z !== 'Unknown'));
    const select = document.getElementById('zone-select');
    select.innerHTML = '<option value="all">All Zones</option>';

    // 정렬 (1구역, 2구역 순)
    const sortedZones = Array.from(zones).sort();

    sortedZones.forEach(zone => {
        const option = document.createElement('option');
        option.value = zone;
        option.textContent = zone;
        select.appendChild(option);
    });
}

function updateLineList(searchTerm = '') {
    let relevantPoles = state.poles;
    if (state.selectedZone !== 'all') {
        relevantPoles = relevantPoles.filter(p => p.zone === state.selectedZone);
    }

    // Group lines by Zone
    const groupedLines = {};
    relevantPoles.forEach(p => {
        if (!p.line) return;
        // Unknown 선로명은 제외하고 싶다면 여기서 필터링 가능, 일단 구역 기준으로 처리
        if (!groupedLines[p.zone]) groupedLines[p.zone] = new Set();
        groupedLines[p.zone].add(p.line);
    });

    const sortedZones = Object.keys(groupedLines).sort();

    const lineListContainer = document.getElementById('line-list');
    lineListContainer.innerHTML = '';

    const fragment = document.createDocumentFragment();

    sortedZones.forEach(zone => {
        // ★ [핵심 수정 2] Unknown 구역 헤더 및 내용 숨기기
        if (zone === 'Unknown') return;

        // Collect Lines for this zone
        const lines = Array.from(groupedLines[zone]).sort();
        // Filter lines by search term
        const visibleLines = lines.filter(l => l.toLowerCase().includes(searchTerm.toLowerCase()));

        if (visibleLines.length > 0) {
            // Group Header
            const header = document.createElement('div');
            header.className = 'zone-group-header';
            header.textContent = zone;
            fragment.appendChild(header);

            // Lines
            visibleLines.forEach(line => {
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
        }
    });

    if (fragment.childElementCount === 0) {
        lineListContainer.innerHTML = '<div style="padding:10px; color:#64748b; font-size:0.9rem;">No lines found</div>';
    } else {
        lineListContainer.appendChild(fragment);
    }
}

function applyFilters() {
    state.visiblePoles = state.poles.filter(p => {
        if (state.selectedZone !== 'all' && p.zone !== state.selectedZone) return false;
        if (state.hiddenLines.has(p.line)) return false;
        // Unknown 구역도 리스트에서 뺐으므로 지도에서도 숨김 (선택 사항)
        if (p.zone === 'Unknown') return false;
        return true;
    });

    renderPoints();
}

function createPopupContent(cluster) {
    const points = cluster.points;
    const topAddress = points.length > 0 ? (points[0].addr || '주소 없음') : '정보 없음';

    let html = `
        <div class="popup-header">
            <h3>${topAddress}</h3>
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
                        <th>주소</th>
                    </tr>
                </thead>
                <tbody>
    `;

    points.forEach(p => {
        html += `
            <tr>
                <td>${p.circuit}</td>
                <td>${p.id}</td>
                <td>${p.line_num}</td>
                <td>${p.lat.toFixed(6)}</td>
                <td>${p.lng.toFixed(6)}</td>
                <td>${p.addr}</td>
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
        marker.bindPopup(popupContent, { maxWidth: 900 });

        clusterGroup.addLayer(marker);
    });

    state.layers.clusters = clusterGroup;
    state.map.addLayer(clusterGroup);

    if (state.visiblePoles.length > 0) {
        const bounds = L.latLngBounds(state.visiblePoles.map(p => [p.lat, p.lng]));
        state.map.fitBounds(bounds, { padding: [50, 50] });
    }

    updateStats();
}

function updateStats() {
    const visibleEl = document.getElementById('visible-count');
    const clusterEl = document.getElementById('cluster-count');
    if (visibleEl) visibleEl.textContent = state.visiblePoles.length.toLocaleString();
    if (clusterEl) clusterEl.textContent = state.currentClusters.length.toLocaleString();
}