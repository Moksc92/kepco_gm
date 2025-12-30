// State
const state = {
    selectedZone: 'all',
    hiddenLines: new Set(),
    poles: [],
    visiblePoles: [],
    currentClusters: [], // Store clusters to count them
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

    // Group by line first for "same line" requirement
    const byLine = {};
    points.forEach((p) => {
        if (!byLine[p.line]) byLine[p.line] = [];
        byLine[p.line].push(p);
    });

    Object.keys(byLine).forEach(lineName => {
        const linePoints = byLine[lineName];
        const visited = new Set(); // index based

        for (let i = 0; i < linePoints.length; i++) {
            if (visited.has(i)) continue;

            const current = linePoints[i];
            const cluster = {
                lat: current.lat,
                lng: current.lng,
                count: 1,
                line: lineName,
                // Store ALL points in the cluster for the detail view
                points: [current]
            };
            visited.add(i);

            for (let j = i + 1; j < linePoints.length; j++) {
                if (visited.has(j)) continue;

                const neighbor = linePoints[j];
                const dist = getDistance(current.lat, current.lng, neighbor.lat, neighbor.lng);

                if (dist <= CONFIG.clusterDistance) {
                    const newCount = cluster.count + 1;
                    // Weighted average for center
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

// App Logic
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function initApp() {
    state.poles = POLE_DATA;
    state.visiblePoles = [...state.poles];

    // Init Map
    state.map = L.map('map').setView(CONFIG.defaultCenter, CONFIG.defaultZoom);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(state.map);

    populateZoneFilter();
    updateLineList();
    renderPoints(); // This will also update stats

    setupEventListeners();
}

function setupEventListeners() {
    document.getElementById('zone-select').addEventListener('change', (e) => {
        state.selectedZone = e.target.value;
        state.hiddenLines.clear();
        updateLineList();
        applyFilters();
    });

    document.getElementById('line-search').addEventListener('input', (e) => {
        updateLineList(e.target.value);
    });

    document.getElementById('btn-download').addEventListener('click', downloadCSV);
}

// CSV Download Logic (Requirement 4)
function downloadCSV() {
    const data = state.visiblePoles;
    if (data.length === 0) {
        alert('No data to download.');
        return;
    }

    // Headers
    const headers = ['회선명', '전산화번호', '선로명', '선로번호', '구역', '위도', '경도', '주소'];

    // Rows
    const rows = data.map(p => [
        p.circuit,
        p.id,
        p.line,
        p.line_num,
        p.zone,
        p.lat,
        p.lng,
        p.addr
    ]);

    // CSV Content with BOM for Korean support in Excel
    const BOM = '\uFEFF';
    let csvContent = BOM + headers.join(',') + '\n';

    rows.forEach(row => {
        // Escape commas in data if any
        const safeRow = row.map(item => {
            const str = String(item || '');
            return str.includes(',') ? `"${str}"` : str;
        });
        csvContent += safeRow.join(',') + '\n';
    });

    // Download
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

    const lines = new Set(relevantPoles.map(p => p.line).filter(l => l));
    const sortedLines = Array.from(lines).sort();
    const displayLines = sortedLines.filter(l => l.toLowerCase().includes(searchTerm.toLowerCase()));

    const lineListContainer = document.getElementById('line-list');
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
    // Enhanced Popup (Requirement 2)
    // Table with: 회선명, 전산화번호, 선로번호, 위도, 경도
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
        html += `
            <tr>
                <td>${p.circuit}</td>
                <td>${p.id}</td>
                <td>${p.line_num}</td>
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
            // Unified Marker Style (Requirement 3)
            // Single points also use circle design with number 1
            size = 30;
            className = 'marker-single-custom'; // Greenish circle
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

    if (state.visiblePoles.length > 0) {
        const bounds = L.latLngBounds(state.visiblePoles.map(p => [p.lat, p.lng]));
        state.map.fitBounds(bounds, { padding: [50, 50] });
    }

    updateStats();
}

function updateStats() {
    // Requirement 1: Cluster Count stats
    document.getElementById('visible-count').textContent = state.visiblePoles.length.toLocaleString();
    document.getElementById('cluster-count').textContent = state.currentClusters.length.toLocaleString();
}
