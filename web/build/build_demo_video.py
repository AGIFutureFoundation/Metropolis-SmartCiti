#!/usr/bin/env python3
"""Narrated demo video for the Monad deck.

    python3 build_demo_video.py  -> omega-stewards-monad-demo.mp4 (1920x1080, H.264 + AAC)

Frames are Chrome-headless screenshots of the deck's own sections (agentic-worlds-monad.html) plus a terminal-style
view of loop/ledger.jsonl. Narration is macOS `say` (synthetic voice). Scene list: demo_script.json.
"""
import json, os, subprocess, sys, html

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, ".video")
DECK = os.path.join(HERE, "agentic-worlds-monad.html")
LEDGER = os.path.join(os.path.dirname(HERE), "Metropolis-SmartCiti", "loop", "ledger.jsonl")
OUT = os.path.join(HERE, "omega-stewards-monad-demo.mp4")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
W, H = 1920, 1080
os.makedirs(WORK, exist_ok=True)

SCENE_JS = """<script>
const s=new URLSearchParams(location.search).get('s');
if(s){document.querySelector('nav')?.remove();
document.querySelectorAll('section').forEach(x=>{if(x.id!==s)x.remove();else{x.style.borderBottom='0';x.style.paddingTop='40px'}});
document.querySelectorAll('table').forEach(t=>{const r=t.rows;for(let i=r.length-1;i>9;i--)r[i].remove()});
document.body.style.zoom='1.35';}
</script></body>"""


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"failed: {cmd[0]} ... \n{r.stderr[-800:]}")
    return r


def ledger_page():
    rows = []
    for l in open(LEDGER):
        e = json.loads(l)
        k = e["kind"]
        if k == "cycle-start":
            rows.append(f'<div class=c># cycle {e["cycle"]}: {html.escape(e["module"])}</div>')
        elif k == "x402":
            rows.append(f'<div><b>x402</b> {e["buyer"].split(".")[-1]} → {e["seller"].split(".")[-1]} '
                        f'{int(e["amount"])/1e6:g} tOMEGA  tx {e["tx"][:14]}…  receipt #{e["receipt"]} head {e["head"][:10]}…</div>')
        elif k == "erc8004-feedback":
            rows.append(f'<div class=f>  ↳ ERC-8004 feedback {e["from"].split(".")[-1]} → {e["to"].split(".")[-1]}</div>')
        elif k == "credential":
            rows.append(f'<div class=g><b>credential</b> {html.escape(e["module"])} → learner {e["learner"][:10]}…  '
                        f'(2-of-3 stewards)  tx {e["tx"][:14]}…</div>')
    page = ("<html><body style='margin:0;background:#0d0b18;color:#d8d3f0;font:22px/1.5 Menlo,monospace;padding:40px 56px'>"
            "<style>.c{color:#836ef9;margin-top:10px}.f{color:#8c87a8}.g{color:#3fbf7f}b{color:#b9acff}.g b{color:#3fbf7f}</style>"
            "<div style='color:#836ef9;font-size:26px'>$ node agents/swarm_loop.mjs --cycles 3   # Monad testnet, chain 10143</div>"
            + "".join(rows[:34]) + "</body></html>")
    p = os.path.join(WORK, "ledger.html")
    open(p, "w").write(page)
    return p


def shoot(url, png):
    run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--window-size={W},{H}",
         "--virtual-time-budget=4000", f"--screenshot={png}", url])


def main():
    spec = json.load(open(os.path.join(HERE, "demo_script.json")))
    scene_html = os.path.join(WORK, "scene.html")
    deck = open(DECK).read().replace('src="media/', f'src="{HERE}/media/').replace('poster="media/', f'poster="{HERE}/media/')
    open(scene_html, "w").write(deck.replace("</body>", SCENE_JS))
    led = ledger_page()
    parts = []
    for i, sc in enumerate(spec["scenes"]):
        png, aiff, mp4 = (os.path.join(WORK, f"s{i:02d}.{x}") for x in ("png", "aiff", "mp4"))
        url = "file://" + (led if sc["shot"] == "ledger" else scene_html + "?s=" + sc["shot"])
        shoot(url, png)
        run(["say", "-v", spec["voice"], "-r", str(spec["rate"]), "-o", aiff, sc["say"]])
        # still frame for the length of the narration + 0.6 s pause, with a gentle fade in/out
        dur = float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", aiff]).stdout) + 0.6
        run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-i", png, "-i", aiff,
             "-vf", f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=0x0b0a14,"
                    f"fade=t=in:st=0:d=0.4,fade=t=out:st={dur-0.4:.2f}:d=0.4,format=yuv420p",
             "-af", "apad", "-t", f"{dur:.2f}", "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
             "-c:a", "aac", "-b:a", "160k", "-ar", "48000", mp4])
        parts.append(mp4)
        print(f"scene {i} {sc['shot']:8s} {dur:5.1f}s")
    lst = os.path.join(WORK, "list.txt")
    open(lst, "w").write("".join(f"file '{p}'\n" for p in parts))
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", "-movflags", "+faststart", OUT])
    total = float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", OUT]).stdout)
    print(f"wrote {OUT}  {total:.1f}s  {os.path.getsize(OUT)/1e6:.1f} MB")


if __name__ == "__main__":
    main()
