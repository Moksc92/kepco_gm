// 1. Supabase 설정
const supabaseUrl = 'https://crmgocruuhldfujfdech.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNybWdvY3J1dWhsZGZ1amZkZWNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwNzQ1MTQsImV4cCI6MjA4MjY1MDUxNH0.ZdvfbMLdt9mdSIePlwjST9SkeWB2Ih4aHK6Egv0FfN4';

// ★ 수정됨: 변수 이름을 'supabase' -> 'supabaseClient'로 변경하여 충돌 방지
const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);

// 2. 전역 변수
let map;
let markers;
let allData = [];

// 3. 앱 시작
document.addEventListener('DOMContentLoaded', () => {
    // 로그인 버튼 이벤트
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', handleLogin);
        document.getElementById('password').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleLogin();
        });
    }
});

// 4. 로그인 처리
async function handleLogin() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    try {
        // ★ 수정됨: supabaseClient 사용
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) throw error;

        // 로그인 성공 UI
        document.getElementById('login-modal').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        
        // 지도 및 데이터 로드 시작
        initMap();
        fetchAndMapData();

    } catch (err) {
        alert('로그인 실패: ' + err.message);
    }
}

// 5. 지도 초기화
function initMap() {
    map = L.map('map').setView([37.47, 126.88], 13);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

    markers = L.markerClusterGroup({
        disableClusteringAtZoom: 18
    });
    map.addLayer(markers);

    setTimeout(() => map.invalidateSize(), 200);
}

// 6. 데이터 가져오기 및 매핑
async function fetchAndMapData() {
    try {
        // ★ 수정됨: supabaseClient 사용
        let { data, error } = await supabaseClient
            .from('poles')
            .select('*')
            .limit(10000);

        if (error) throw error;

        // 데이터 매핑 (DB 컬럼명 -> 코드 변수명)
        allData = data.map(row => {
            return {
                id: row['전산화번호'],
                lat: parseFloat(row['위도']),
                lng: parseFloat(row['경도']),
                // ★ 고객님 DB 컬럼명 반영
                zone: row['구역(4등분)'] || row['구역'] || '미분류',
                line: row['선로명'] || row['회선명'] || '미분류'
            };
        }).filter(item => !isNaN(item.lat) && !isNaN(item.lng));

        console.log('데이터 로드 완료:', allData.length, '개');

        // 필터 및 지도 그리기
        initZoneFilter();
        
        // 첫 번째 구역 자동 선택 (데이터가 있으면)
        if (allData.length > 0) {
            // "전체 구역" 다음의 첫 번째 실질 구역을 선택
            setTimeout(() => {
                const select = document.getElementById('zone-select');
                if (select.options.length > 1) {
                    select.selectedIndex = 1; // 0번은 'all', 1번이 첫 구역
                    filterData(select.value);
                }
            }, 100);
        }

    } catch (err) {
        console.error(err);
        alert('데이터 로드 중 오류가 발생했습니다.');
    }
}

// 7. 구역 필터 생성
function initZoneFilter() {
    const zones = [...new Set(allData.map(d => d.zone))].sort();
    const select = document.getElementById('zone-select');
    select.innerHTML = '<option value="all">전체 구역</option>';

    zones.forEach(z => {
        const option = document.createElement('option');
        option.value = z;
        option.textContent = z;
        select.appendChild(option);
    });

    select.addEventListener('change', (e) => {
        filterData(e.target.value);
    });
}

// 8. 데이터 필터링
function filterData(selectedZone) {
    let filteredData = allData;
    if (selectedZone !== 'all') {
        filteredData = allData.filter(d => d.zone === selectedZone);
    }
    updateLineList(filteredData);
    renderMarkers(filteredData);
}

// 9. 마커 그리기
function renderMarkers(data) {
    markers.clearLayers();

    data.forEach(d => {
        const marker = L.marker([d.lat, d.lng], { title: d.line });
        marker.bindPopup(`
            <div style="text-align:center;">
                <b>${d.line}</b><br>
                <span style="font-size:12px; color:#666;">${d.id}</span><br>
                <span style="font-size:12px; color:#888;">${d.zone}</span>
            </div>
        `);
        markers.addLayer(marker);
    });

    if (data.length > 0) {
        map.fitBounds(markers.getBounds());
    }
    
    document.getElementById('visible-count').textContent = data.length;
    setTimeout(() => {
        document.getElementById('cluster-count').textContent = 'Auto';
    }, 500);
}

// 10. 선로 목록 업데이트
function updateLineList(data) {
    const listContainer = document.getElementById('line-list');
    listContainer.innerHTML = '';

    const lines = [...new Set(data.map(d => d.line))].sort();

    lines.forEach(lineName => {
        const div = document.createElement('div');
        div.style.padding = '8px';
        div.style.borderBottom = '1px solid #444';
        div.style.color = '#eee';
        div.style.fontSize = '14px';
        div.innerHTML = `<i class="fa-solid fa-bolt" style="color:#00d2ff; margin-right:8px;"></i> ${lineName}`;
        
        div.style.cursor = 'pointer';
        div.onclick = () => {
             const lineData = data.filter(d => d.line === lineName);
             renderMarkers(lineData);
        };
        listContainer.appendChild(div);
    });
}