"""Second half of the Monad deck: loop, agents, worlds, claims, next."""


def rest(c):
    dep, con, kinds, E, addr, tx, img = c["dep"], c["con"], c["kinds"], c["E"], c["addr"], c["tx"], c["img"]
    creds, pays = c["creds"], c["pays"]
    teams = sorted({n.split(".")[0] for n in dep["agents"]})
    short = lambda n: n.split(".")[-1]
    pay_rows = "".join(f"<tr><td>{E(short(p['buyer']))} → {E(short(p['seller']))}</td><td>{E(p.get('why', ''))}</td>"
                       f"<td>{int(p['amount']) / 1e6:g} tOMEGA</td><td>{tx(p['tx'])}</td></tr>" for p in pays)
    cred_rows = "".join(f"<tr><td>{E(x['module'])}</td><td>{addr(x['learner'])}</td><td>{tx(x['tx'])}</td></tr>" for x in creds)
    agent_rows = "".join(f"<tr><td>#{a['erc8004Id']}</td><td>{E(n)}</td><td>{addr(a['wallet'])}</td><td>{tx(a['registerTx'])}</td></tr>"
                         for n, a in sorted(dep["agents"].items(), key=lambda x: x[1]["index"]))
    modules = ", ".join(E(m) for m in dict.fromkeys(x["module"] for x in creds))
    head = con["receiptHead"]
    return f"""
<section id="loop"><div class="kick">The swarm loop</div><h2>{con['cycles']} cycles, <b>{kinds['x402']} payments, {len(creds)} credentials</b></h2>
<p class="lead">Each cycle is one Trade Craft module. Agents buy the work it needs from each other and rate each other; then the stewards certify the learner. Final receipt head <span class="mono">{head[:12]}…{head[-4:]}</span>.</p>
<div class="two"><div><p class="note">x402 payments</p><table><tr><th>Buyer → seller</th><th>For</th><th>Amount</th><th>Tx</th></tr>{pay_rows}</table></div>
<div><p class="note">Credentials (2-of-3 steward signatures)</p><table><tr><th>Module</th><th>Learner</th><th>Tx</th></tr>{cred_rows}</table>
<p class="note">Modules certified: {modules}.</p></div></div></section>

<section id="agents"><div class="kick">Identity</div><h2>{len(dep['agents'])} agents, <b>{len(teams)} teams</b>, each with an ERC-8004 ID</h2>
<p class="lead">Teams: {', '.join(E(t) for t in teams)}. Each registration points to the agent's public card in the repo. The full roster is 78 agents; this testnet run seats the first {len(dep['agents'])}.</p>
<table><tr><th>ID</th><th>Agent</th><th>Wallet</th><th>Register tx</th></tr>{agent_rows}</table></section>

<section id="worlds"><div class="kick">Where the agents come from</div><h2>SmartCiti.X: <b>41 agentic worlds</b>, governed by people</h2>
<div class="two" style="margin-top:18px">{img('worlds', '41 worlds built from SmartCiti.X Master Cards')}{img('gov', 'Governance: six actions always held for people')}</div>
<div class="stats"><div class="stat"><b>41</b><span>worlds</span></div><div class="stat"><b>939</b><span>SmartCiti.X Master Cards</span></div><div class="stat"><b>447</b><span>agent avatars</span></div><div class="stat"><b>1066</b><span>WorldForge evals, 0 failing</span></div></div>
<p class="lead" style="margin-top:18px">Every place, agent and seat is an owned Master Card with a seven-right permission table. Six actions are always held for a 2-of-3 human Steward Council: <code>governance.final_vote</code>, <code>charter.amend</code>, <code>treasury.transfer</code>, <code>proposal.enact</code>, <code>windfall.distribute</code>, <code>steward.appoint</code>. Omega Stewards turns that rule into a contract on Monad.</p>
<p class="note">World-network figures from the source deck, built 2026-10-12 from the WorldForge registries.</p></section>

<section id="claims"><div class="kick">Honesty</div><h2>What we <b>do</b> and <b>do not</b> claim</h2>
<div class="two"><div class="card"><h3>We claim</h3><ul><li>4 contracts and {len(dep['agents'])} ERC-8004 agent registrations live on Monad testnet.</li><li>{kinds['x402']} x402 payments, {kinds['erc8004-feedback']} reputation entries and {len(creds)} steward-signed credentials, all confirmed onchain.</li><li>A passkey-curve (P-256) multisig verified by Monad's precompile.</li></ul></div>
<div class="card"><h3>We do not claim</h3><ul><li><b>tOMEGA has no market value</b> and no bridge to $OMEGA (a Virtuals agent token). It exists so the x402 economy runs on testnet.</li><li>Nothing is on Monad mainnet. The steward keys in this run are test keys, not seated human stewards.</li><li>The 939 world NFTs remain draft metadata, not minted. Lessons are drafts; voices are synthetic.</li><li>SmartCiti.X has no revenue or users to report yet.</li></ul></div></div></section>

<section id="next"><div class="kick">Next</div><h2>Every step names <b>the person who decides</b></h2>
<div class="three" style="margin-top:18px">
<div class="card"><h3>1 · Seat real stewards</h3><p>Three people per council enrol device passkeys and the test keys are retired. <span class="note">Gate: the board appoints stewards.</span></p></div>
<div class="card"><h3>2 · Full roster</h3><p>Register all 78 agents and run the loop on every Trade Craft module. <span class="note">Gate: the founder funds the deployer.</span></p></div>
<div class="card"><h3>3 · Mainnet</h3><p>Move to Monad mainnet once stewards are seated and an audit is done. <span class="note">Gate: board and counsel.</span></p></div>
</div>
<p class="lead" style="margin-top:26px">Repo <a href="{c['REPO']}">{c['REPO']}</a> · Contact <span class="mono">x@agifuturefoundation.org</span></p></section>"""
