"""CSS for the Monad deck (Monad purple on the original deck's dark layout)."""
CSS = """
:root{--bg:#0b0a14;--panel:#15132a;--ink:#eeeaf8;--ink2:#a49fbf;--line:#2a2648;--mon:#836ef9;--mon2:#b9acff;--good:#3fbf7f;--warn:#e0a03a}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif}
nav{position:sticky;top:0;z-index:5;display:flex;gap:14px;flex-wrap:wrap;align-items:center;padding:10px 24px;
 background:rgba(11,10,20,.92);border-bottom:1px solid var(--line);backdrop-filter:blur(8px)}
nav b{color:var(--mon2);margin-right:auto}nav a{color:var(--ink2);text-decoration:none;font-size:13px}nav a:hover{color:var(--ink)}
section{max-width:1180px;margin:0 auto;padding:56px 24px;border-bottom:1px solid var(--line)}
h1{font-size:46px;line-height:1.1;margin:0 0 10px}h1 b,h2 b{color:var(--mon2);font-weight:600}h2{font-size:30px;margin:0 0 8px}
.kick{color:var(--mon);font-size:13px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:6px}
.lead{color:var(--ink2);font-size:18px;max-width:860px}.note{color:var(--ink2);font-size:13px}
.hero{display:grid;grid-template-columns:1.15fr 1fr;gap:28px;align-items:center}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:22px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px}
.stat b{display:block;font-size:30px;color:var(--mon2)}.stat span{color:var(--ink2);font-size:13px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:22px}.three{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
@media(max-width:900px){.hero,.two,.three{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px 18px}
.card h3{margin:0 0 8px;font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:var(--mon2)}
ul{margin:6px 0 0 18px;padding:0}li{margin:5px 0}
figure{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}
figure video,figure img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:#000}
figcaption{padding:9px 12px;font-size:13px;color:var(--ink2)}.missing .ph{aspect-ratio:16/9;display:grid;place-items:center;color:var(--ink2)}
table{width:100%;border-collapse:collapse;margin-top:14px;font-size:14px}
td,th{border-bottom:1px solid var(--line);padding:8px 6px;text-align:left;vertical-align:top}
th{color:var(--ink2);font-weight:500;font-size:12px;text-transform:uppercase;letter-spacing:.05em}
a{color:var(--mon2)}.mono{font-family:ui-monospace,Menlo,monospace;font-size:13px;word-break:break-all}
.flow{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:18px}
.flow span{background:var(--panel);border:1px solid var(--mon);border-radius:20px;padding:7px 14px;font-size:14px}.flow i{color:var(--mon);font-style:normal}
.pill{display:inline-block;font-size:12px;padding:2px 9px;border-radius:12px;border:1px solid var(--good);color:var(--good);margin:0 6px 6px 0}
code{background:#1d1a36;padding:1px 6px;border-radius:4px;font-size:13px}
"""
