import csv
import json
import os

# Paths
csv_path = r"C:\Users\user\.gemini\antigravity\scratch\pole_map_visualization\data.csv"
js_path = r"C:\Users\user\.gemini\antigravity\scratch\pole_map_visualization\pois.js"

data = []

def process_row(row):
    try:
        lat = float(row.get('위도', 0))
        lng = float(row.get('경도', 0))
        zone = row.get('구역(4등분)', 'Unknown')
        line = row.get('선로명', 'Unknown')
        
        if lat != 0 and lng != 0:
             data.append({
                'lat': lat,
                'lng': lng,
                'zone': zone,
                'line': line,
                'id': row.get('전산화번호', ''),
                'addr': row.get('인근주소(참고자료)', ''),
                # New fields
                'circuit': row.get('회선명', ''),
                'line_num': row.get('선로번호', '')
            })
    except ValueError:
        pass

try:
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            process_row(row)

except UnicodeDecodeError:
    print("UTF-8 decoding failed, trying cp949...")
    with open(csv_path, 'r', encoding='cp949') as f:
        reader = csv.DictReader(f)
        for row in reader:
             process_row(row)

# Write to JS file
js_content = f"const POLE_DATA = {json.dumps(data, ensure_ascii=False, indent=2)};"

with open(js_path, 'w', encoding='utf-8') as f:
    f.write(js_content)

print(f"Successfully converted {len(data)} records to {js_path}")
