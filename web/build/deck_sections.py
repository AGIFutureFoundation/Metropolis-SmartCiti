"""Sections of the Monad deck. Every onchain figure comes from ctx (deployment record + ledger)."""
from deck_sections1b import problem_what_monad_live


def sections(c):
    from deck_sections2 import rest
    dep, kinds, have = c["dep"], c["kinds"], c["have"]
    ids = sorted(a["erc8004Id"] for a in dep["agents"].values())
    creds = [e for e in c["led"] if e["kind"] == "credential"]
    c.update(ids=ids, creds=creds, pays=[e for e in c["led"] if e["kind"] == "x402"])
    film = (f'<figure><video controls preload="metadata" poster="{have.get("poster", "")}" src="{have["film"]}"></video>'
            '<figcaption>Features film (1:50, synthetic narration): the world network these agents come from.</figcaption></figure>'
            if "film" in have else '<figure class="missing"><div class="ph">film missing</div></figure>')
    nav = ('<nav><b>Omega Stewards · Monad</b><a href="#problem">Problem</a><a href="#what">What</a><a href="#monad">Why Monad</a>'
           '<a href="#live">Live</a><a href="#loop">Loop</a><a href="#agents">Agents</a><a href="#worlds">Worlds</a>'
           '<a href="#claims">Claims</a><a href="#next">Next</a></nav>')
    hero = f"""
<section id="top"><div class="hero"><div>
<div class="kick">Monad Metropolis · Track 04: Trust, Identity &amp; AI Infrastructure</div>
<h1>Agents operate.<br><b>People govern.</b> Onchain on Monad.</h1>
<p class="lead">AI agents from the SmartCiti.X Trade Craft Academy hold their own wallets and <b>ERC-8004</b> identities, pay each other with <b>x402</b>, and rate each other against every receipt. Anything that matters needs <b>2 of 3 human stewards</b> signing with passkey-curve keys, checked by Monad's native P-256 precompile.</p>
<p><span class="pill">live on testnet · chain {dep['chainId']}</span><span class="pill">{len(dep['agents'])} agents registered</span><span class="pill">41/41 transactions confirmed</span></p>
<p class="note">AGI Future Foundation PBC · Powered by AGI Corp · <a href="{c['REPO']}">{c['REPO'].replace('https://', '')}</a></p>
</div>{film}</div>
<div class="stats">
<div class="stat"><b>{len(dep['agents'])}</b><span>agents with ERC-8004 IDs #{ids[0]}–#{ids[-1]}</span></div>
<div class="stat"><b>{kinds['x402']}</b><span>x402 payments settled, each with a hash-chained receipt</span></div>
<div class="stat"><b>{kinds['erc8004-feedback']}</b><span>ERC-8004 reputation entries tied to receipts</span></div>
<div class="stat"><b>{len(creds)}</b><span>Trade Craft credentials minted by 2-of-3 stewards</span></div>
</div><p class="note">Read from deployments/monad-testnet.json and loop/ledger.jsonl. Every transaction re-checked against the Monad testnet RPC on 2026-10-14.</p></section>"""
    return nav + hero + problem_what_monad_live(c) + rest(c)
