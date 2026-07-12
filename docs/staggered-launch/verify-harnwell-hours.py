import csv

DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
# day -> (seatA_col, seatB_col)
COLS = {'Monday':(1,2),'Tuesday':(3,4),'Wednesday':(5,6),'Thursday':(7,8),
        'Friday':(9,10),'Saturday':(11,12),'Sunday':(13,14)}
BANDS = ['5:30am-6am','6am-7am','7am-8am','8am-9am','9am-10am','10am-11am','11am-12pm',
         '12pm-1pm','1pm-2pm','2pm-3pm','3pm-4pm','4pm-5pm','5pm-6pm','6pm-7pm','7pm-8pm',
         '8pm-9pm','9pm-10pm','10pm-11pm','11pm-12am']
def band_hours(b): return 0.5 if b=='5:30am-6am' else 1.0

rows = {}
with open('/tmp/harnwell.csv') as f:
    for r in csv.reader(f):
        if r and r[0].strip() in BANDS:
            rows[r[0].strip()] = r

hours = {}
open_h = 0.0
assign = {}  # (day,band) -> [seatA, seatB]
for b in BANDS:
    r = rows[b]
    h = band_hours(b)
    for day in DAYS:
        a,bcol = COLS[day]
        sa = r[a].strip() if a < len(r) else ''
        sb = r[bcol].strip() if bcol < len(r) else ''
        assign[(day,b)] = [sa, sb]
        for name in (sa, sb):
            if name == '' : continue
            if name == 'OPEN':
                open_h += h
            else:
                hours[name] = hours.get(name,0)+h

legend = {'Eleni':23,'Abraham':24,'Drew':24,'Valeria':23,'Aaron':23,'Lealem':24,
          'Ornella':24.5,'Andrew C.':23,'Purity':30.5}
print("=== Per-worker hours: computed vs legend ===")
allok=True
for name in legend:
    c = hours.get(name,0)
    ok = '✓' if abs(c-legend[name])<1e-9 else 'MISMATCH'
    if ok!='✓': allok=False
    print(f"  {name:12} computed={c:5}  legend={legend[name]:5}  {ok}")
extra = set(hours)-set(legend)
if extra: print("  UNEXPECTED names:", extra); allok=False
print(f"\nOPEN hours = {open_h}")
print(f"Total worker hours = {sum(hours.values())}  (legend sum = {sum(legend.values())})")
print(f"Total incl OPEN = {sum(hours.values())+open_h}")
print("\nALL RECONCILE" if allok else "\n*** DISCREPANCY ***")
