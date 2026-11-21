import json, random, sys
sys.path.insert(0, sys.argv[1])
from pipeline.common import taker_fee
F = json.load(open(sys.argv[1] + "/output/flags.json"))["flags"]; random.seed(4044); S = random.sample(F, 20)
print("20 sampled flags (seed 4044, run 4): fee=taker_fee(cat,ask); edge=win_prob-(ask+fee); edge_low=win_prob_low-(ask+fee); roi=(win_prob-cost)/cost*100")
bad = 0
for f in S:
    s = f["best"]; a = s["ask"]; fee = taker_fee(f["category"], a); c = a + fee
    e = s["win_prob"] - c; el = s["win_prob_low"] - c; r = (s["win_prob"] - c) / c * 100
    ok = abs(fee - s["fee"]) < 6e-4 and abs(e - s["edge"]) < 2e-4 and abs(el - s["edge_low"]) < 2e-4 and abs(r - s["roi_pct"]) < 0.02
    bad += not ok
    print(f" {f['id']:>8} {f['category']:9} ask={a:<6} fee {s['fee']:.4f} vs {fee:.4f}  edge {s['edge']:.4f} vs {e:.4f}  edge_low {s['edge_low']:.4f} vs {el:.4f}  roi {s['roi_pct']} vs {r:.2f}  {'OK' if ok else 'MISMATCH'}")
print("mismatches:", bad)
