// 1. Supabase 설정 (고객님 프로젝트 정보)
const supabaseUrl = 'https://crmgocruuhldfujfdech.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNybWdvY3J1dWhsZGZ1amZkZWNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwNzQ1MTQsImV4cCI6MjA4MjY1MDUxNH0.ZdvfbMLdt9mdSIePlwjST9SkeWB2Ih4aHK6Egv0FfN4';
const supabase = supabase.createClient(supabaseUrl, supabaseKey);

// 2. 전역 변수 설정
let map;
let markers; // 클러스터 그룹
let allData = []; // DB에서 가져온 전체 데이터

// 3. 앱 시작 (HTML 로딩 완료 후)
document.addEventListener('DOMContentLoaded', () => {
    // 로그인 버튼 이벤트
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', handleLogin);
        // 엔터키 로그인 지원
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
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) throw error;

        // 로그인 성공 UI 처리
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
    // 맵 생성 (초기 위치: 광명)
    map = L.map('map').setView([37.47, 126.88], 13);
    
    // 어두운 테마 지도 타일
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

    // 마커 클러스터 그룹 생성 (50m 근처 뭉치기 효과)
    markers = L.markerClusterGroup({
        disableClusteringAtZoom: 18 // 아주 가까이 가면 뭉치기 해제
    });
    map.addLayer(markers);

    // 지도 깨짐 방지
    setTimeout(() => map.invalidateSize(), 200);
}

// 6. 데이터 가져오기 및 매핑 (★가장 중요한 부분★)
async function fetchAndMapData() {
    try {
        // Supabase에서 데이터 가져오기
        let { data, error } = await supabase
            .from('poles')
            .select('*')
            .limit(10000); // 넉넉하게 제한 해제

        if (error) throw error;

        // ★ 데이터 이름표 바꿔주기 (한글 컬럼 -> 영어 변수)
        allData = data.map(row => {
            return {
                id: row['전산화번호'],
                lat: parseFloat(row['위도']),
                lng: parseFloat(row['경도']),
                // ★ 여기가 핵심 수정 사항
                zone: row['구역(4등분)'] || row['구역'] || '미분류',
                line: row['선로명'] || row['회선명'] || '미분류'
            };
        }).filter(item => !isNaN(item.lat) && !isNaN(item.lng)); // 좌표 없는 데이터 제거

        console.log('데이터 로드 완료:', allData.length, '개');

        // 필터(드롭다운) 만들기
        initZoneFilter();
        
        // 처음에 전체 데이터 보여주기 (또는 1구역 자동 선택)
        // 여기서는 '전체' 대신 첫 번째 구역을 자동 선택해서 보여줌 (데이터 양이 많으므로)
        if (allData.length > 0) {
            const firstZone = document.getElementById('zone-select').options[1].value; // 첫번째 옵션(All 제외)
            document.getElementById('zone-select').value = firstZone;
            filterData(firstZone);
        }

    } catch (err) {
        console.error(err);
        alert('데이터 로드 중 오류가 발생했습니다.');
    }
}

// 7. 구역 필터(드롭다운) 생성
function initZoneFilter() {
    // 중복 제거된 구역 목록 만들기
    const zones = [...new Set(allData.map(d => d.zone))].sort();
    
    const select = document.getElementById('zone-select');
    select.innerHTML = '<option value="all">전체 구역</option>'; // 기본 옵션

    zones.forEach(z => {
        const option = document.createElement('option');
        option.value = z;
        option.textContent = z;
        select.appendChild(option);
    });

    // 선택 변경 시 이벤트
    select.addEventListener('change', (e) => {
        filterData(e.target.value);
    });
}

// 8. 데이터 필터링 및 화면 표시
function filterData(selectedZone) {
    let filteredData = allData;

    // 1. 구역 필터링
    if (selectedZone !== 'all') {
        filteredData = allData.filter(d => d.zone === selectedZone);
    }

    // 2. 하단 선로 목록 업데이트
    updateLineList(filteredData);

    // 3. 지도에 마커 그리기
    renderMarkers(filteredData);
}

// 9. 지도에 마커 그리기
function renderMarkers(data) {
    markers.clearLayers(); // 기존 마커 싹 지우기

    data.forEach(d => {
        // 마커 생성
        const marker = L.marker([d.lat, d.lng], {
            title: d.line
        });

        // 클릭 시 말풍선
        marker.bindPopup(`
            <div style="text-align:center;">
                <b>${d.line}</b><br>
                <span style="font-size:12px; color:#666;">${d.id}</span><br>
                <span style="font-size:12px; color:#888;">${d.zone}</span>
            </div>
        `);

        markers.addLayer(marker);
    });

    // 마커가 있는 곳으로 지도 이동
    if (data.length > 0) {
        map.fitBounds(markers.getBounds());
    }
    
    // 상단 숫자 업데이트
    document.getElementById('visible-count').textContent = data.length;
    // 클러스터 수는 계산 딜레이 후 표시
    setTimeout(() => {
        document.getElementById('cluster-count').textContent = 'Auto';
    }, 500);
}

// 10. 선로 목록(체크박스 리스트) 만들기
function updateLineList(data) {
    const listContainer = document.getElementById('line-list');
    listContainer.innerHTML = ''; // 초기화

    // 현재 구역에 있는 선로명만 뽑기
    const lines = [...new Set(data.map(d => d.line))].sort();

    lines.forEach(lineName => {
        const div = document.createElement('div');
        div.style.padding = '8px';
        div.style.borderBottom = '1px solid #444';
        div.style.color = '#eee';
        div.style.fontSize = '14px';
        div.innerHTML = `<i class="fa-solid fa-bolt" style="color:#00d2ff; margin-right:8px;"></i> ${lineName}`;
        
        // 클릭하면 해당 선로만 지도에 남기기 (심화 기능)
        div.style.cursor = 'pointer';
        div.onclick = () => {
             // 선택된 선로만 다시 필터링해서 지도에 그리기
             const lineData = data.filter(d => d.line === lineName);
             renderMarkers(lineData);
        };

        listContainer.appendChild(div);
    });
}