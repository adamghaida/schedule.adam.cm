#!/usr/bin/env python3
"""Rebuild data.js from CMU's public Schedule of Classes (Doha courses only).

Usage:
    python3 scripts/update_data.py                # the two newest non-summer semesters
    python3 scripts/update_data.py S27 F26        # specific semesters; the first one is shown by default
    python3 scripts/update_data.py --cache .cache # keep downloaded pages so a re-run is instant

Only the standard library is used. One search request per semester plus one
detail request per course (about 160 per semester), a few at a time.
"""
import argparse
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = 'https://enr-apps.as.cmu.edu/open/SOC/SOCServlet'
UA = {'User-Agent': 'Mozilla/5.0 (cmuq-schedule-planner data refresh)'}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DEPT_NAMES = {
    'BIOLOGICAL SCIENCES': 'Biological Sciences',
    'BUSINESS ADMINISTRATION': 'Business Administration',
    'QATAR CAMPUS WIDE STUDIES': 'Qatar Campus-Wide Studies',
    'CARNEGIE MELLON UNIVERSITY-WIDE STUDIES': 'University-Wide Studies',
    'CHEMISTRY': 'Chemistry',
    'COMPUTER SCIENCE': 'Computer Science',
    'CM INSTITUTE FOR STRATEGY AND TECH': 'Institute for Strategy & Technology',
    'ECONOMICS': 'Economics',
    'ENGLISH': 'English',
    'HUMAN-COMPUTER INTERACTION': 'Human-Computer Interaction',
    'HISTORY': 'History',
    'DIETRICH COLLEGE INTERDISCIPLINARY': 'Dietrich Interdisciplinary',
    'INFORMATION SYSTEMS PROGRAM': 'Information Systems',
    'LANGUAGES CULTURES & APPL LINGUISTICS': 'Languages, Cultures & Applied Linguistics',
    'LANGUAGE TECHNOLOGIES INSTITUTE': 'Language Technologies',
    'MCS INTERDISCIPLINARY': 'MCS Interdisciplinary',
    'MATHEMATICAL SCIENCES': 'Mathematical Sciences',
    'MUSIC': 'Music',
    'PHYSICAL EDUCATION': 'Physical Education',
    'PHILOSOPHY': 'Philosophy',
    'PHYSICS': 'Physics',
    'PSYCHOLOGY': 'Psychology',
    'SOFTWARE & SOCIETAL SYSTEMS': 'Software & Societal Systems',
    'SCS INTERDISCIPLINARY': 'SCS Interdisciplinary',
    'STATISTICS AND DATA SCIENCE': 'Statistics & Data Science',
    'STUCO (STUDENT LED COURSES)': 'StuCo (Student-Led)',
}


def clean(s):
    s = re.sub(r'<[^>]+>', ' ', s)
    s = html.unescape(s).replace('\xa0', ' ')
    return re.sub(r'\s+', ' ', s).strip()


def get(url, data=None, cache_path=None):
    """Fetch a page as text, optionally through an on-disk cache."""
    if cache_path and os.path.exists(cache_path) and os.path.getsize(cache_path) > 500:
        return open(cache_path, 'rb').read().decode('latin-1')
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, data=data, headers=UA)
            raw = urllib.request.urlopen(req, timeout=60).read()
            if cache_path:
                os.makedirs(os.path.dirname(cache_path), exist_ok=True)
                open(cache_path, 'wb').write(raw)
            time.sleep(0.15)
            return raw.decode('latin-1')
        except Exception as e:  # network hiccup: wait and retry
            last = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f'Could not fetch {url}: {last}')


def read_form(cache):
    """Semesters on offer (code -> label, newest first) and every department code."""
    page = get(BASE + '/search', cache_path=cache and os.path.join(cache, 'form.htm'))
    sem_block = re.search(r'<select id="semester".*?</select>', page, re.S).group(0)
    sems = [(m.group(1), clean(m.group(2))) for m in re.finditer(r'<option[^>]*value="([^"]+)"[^>]*>(.*?)</option>', sem_block, re.S)]
    dept_block = re.search(r'<select multiple id="dept".*?</select>', page, re.S).group(0)
    depts = re.findall(r'value="([^"]+)"', dept_block)
    return sems, depts


def to_min(t):
    m = re.match(r'(\d{1,2}):(\d{2})(AM|PM)$', t)
    if not m:
        return None
    return (int(m.group(1)) % 12 + (12 if m.group(3) == 'PM' else 0)) * 60 + int(m.group(2))


def parse_search(page):
    """Rows of the search result. Continuation rows have no opening <tr>, so split on </tr>."""
    updated = re.search(r'last updated:\s*([^<]+)', page)
    updated = clean(updated.group(1)) if updated else ''
    courses, cur, dept, pos = [], None, None, 0
    for m in re.finditer(r'<h4 class="department-title">(.*?)</h4>|</tr>', page, re.S):
        if m.group(1) is not None:
            dept, pos = clean(m.group(1)), m.end()
            continue
        row, pos = page[pos:m.start()], m.end()
        tds = re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)
        if len(tds) != 10:
            continue
        num = re.search(r'COURSE=(\d{5})', tds[0])
        cells = [clean(t) for t in tds]
        if num:
            cur = {'num': num.group(1), 'title': cells[1], 'units': cells[2], 'dept': dept, 'rows': []}
            courses.append(cur)
        elif cells[1] and cur is not None:
            cur['title'] = (cur['title'] + ' ' + cells[1]).strip()
        if cur is not None:
            cur['rows'].append({'sec': cells[3], 'mini': cells[4], 'days': cells[5], 'begin': cells[6], 'end': cells[7], 'mode': cells[9]})
    return updated, courses


def detail_field(page, label):
    m = re.search(r'<dt>\s*' + re.escape(label) + r'\s*</dt>\s*<dd>(.*?)</dd>', page, re.S)
    return clean(m.group(1)) if m else ''


def build_course(c, detail):
    """Turn raw rows into registerable sections. A lettered section under a 'Lec' row inherits the lecture's meetings."""
    lec, sections, last = None, [], None
    for r in c['rows']:
        mt = None
        if r['days'] and r['days'] != 'TBA' and to_min(r['begin']) is not None:
            mt = {'d': r['days'], 's': to_min(r['begin']), 'e': to_min(r['end'])}
        sec = r['sec']
        if sec == '':  # an extra meeting for the row above
            if last is not None and mt:
                last['m'].append(mt)
            continue
        if sec.startswith('Lec'):
            lec = {'id': sec, 'm': [mt] if mt else [], 'mode': r['mode']}
            last = lec
            continue
        mini = 0
        mm = re.match(r'^[A-Z]+([1-4])$', sec)
        if r['mini'] == 'Y' and mm:
            mini = int(mm.group(1))
        s = {'id': sec, 'm': [mt] if mt else [], 'mini': mini, 'mode': r['mode'], 'lec': lec}
        sections.append(s)
        last = s
    if lec is not None and not sections:
        sections.append({'id': lec['id'], 'm': lec['m'], 'mini': 0, 'mode': lec['mode'], 'lec': None})
    out_secs = []
    for s in sections:
        meetings = [dict(x, k='Lec') for x in s['lec']['m']] if s['lec'] else []
        meetings += [dict(x) for x in s['m']]
        o = {'id': s['id'], 'm': meetings}
        if s['mini']:
            o['mini'] = s['mini']
        if s['lec']:
            o['lec'] = s['lec']['id']
        if s['mode'] and s['mode'] != 'In-person only':
            o['mode'] = s['mode']
        out_secs.append(o)
    out = {'n': c['num'], 't': c['title'], 'u': c['units'], 'd': DEPT_NAMES.get(c['dept'], (c['dept'] or '').title()), 's': out_secs}
    pre = detail_field(detail, 'Prerequisites')
    co = detail_field(detail, 'Corequisites')
    cross = [x for x in re.findall(r'\d{5}', detail_field(detail, 'Cross-Listed Courses')) if x != c['num']]
    if pre and pre.lower() != 'none':
        out['pre'] = pre
    if co and co.lower() != 'none':
        out['co'] = co
    if cross:
        out['x'] = cross
    if detail_field(detail, 'Special Permission Required').lower().startswith('y'):
        out['perm'] = 1
    return out


def build_semester(sem, label, depts, location, cache):
    form = [('SEMESTER', sem), ('MINI', 'NO'), ('GRAD_UNDER', 'All'), ('PRG_LOCATION', location), ('BEG_TIME', 'All'),
            ('KEYWORD', ''), ('TITLE_ONLY', 'YES'), ('SUBMIT', '')] + [('DEPT', d) for d in depts]
    page = get(BASE + '/search', data=urllib.parse.urlencode(form).encode(), cache_path=cache and os.path.join(cache, f'search_{sem}.htm'))
    updated, raw = parse_search(page)
    if not raw:
        raise RuntimeError(f'No {location} courses found for {sem}. The site layout may have changed.')
    print(f'{label}: {len(raw)} courses, fetching details…', flush=True)

    def detail(c):
        return get(f'{BASE}/courseDetails?COURSE={c["num"]}&SEMESTER={sem}', cache_path=cache and os.path.join(cache, 'details', f'{sem}_{c["num"]}.htm'))
    with ThreadPoolExecutor(4) as ex:
        details = list(ex.map(detail, raw))
    courses = [build_course(c, d) for c, d in zip(raw, details)]
    return {'label': label, 'updated': updated, 'courses': courses}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('semesters', nargs='*', help='semester codes such as S27 F26 (first one is the default view)')
    ap.add_argument('--location', default='DOH', help='teaching location code (default: DOH for Doha, Qatar)')
    ap.add_argument('--cache', help='directory for downloaded pages; a re-run reuses them')
    ap.add_argument('--out', default=os.path.join(ROOT, 'data.js'), help='output file (default: data.js next to index.html)')
    args = ap.parse_args()

    sems, depts = read_form(args.cache)
    labels = dict(sems)
    wanted = args.semesters or [code for code, _ in sems if not code.startswith(('M', 'N'))][:2]
    unknown = [s for s in wanted if s not in labels]
    if unknown:
        sys.exit(f'Not offered by the Schedule of Classes right now: {", ".join(unknown)}. Available: {", ".join(labels)}')

    data = {sem: build_semester(sem, labels[sem], depts, args.location, args.cache) for sem in wanted}
    payload = json.dumps(data, separators=(',', ':'), ensure_ascii=False).replace('</', '<\\/')
    with open(args.out, 'w', encoding='utf-8') as f:
        f.write("// Generated by scripts/update_data.py from CMU's public Schedule of Classes. Do not edit by hand.\n")
        f.write('window.CMUQ_SCHEDULE = ' + payload + ';\n')
    print(f'Wrote {args.out} ({os.path.getsize(args.out) // 1024} KB): ' + ', '.join(f'{d["label"]} {len(d["courses"])} courses' for d in data.values()))


if __name__ == '__main__':
    main()
