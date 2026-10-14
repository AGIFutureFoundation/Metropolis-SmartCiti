"""Problem, what we built, why Monad, live contracts."""

CONTRACTS = [
    ("StewardCouncil", "2-of-3 human stewards, P-256 passkey signatures, pause switch, hash-chained governance log"),
    ("OmegaAgentHub", "agent registry, per-agent spending caps, x402 settlement, hash-chained receipts"),
    ("OmegaToken", "tOMEGA test token with EIP-3009 signed transfers, the scheme x402 uses"),
    ("TradeCraftCredential", "non-transferable Trade Craft certificates, minted only by the stewards"),
]

PROBLEM = """
<section id="problem"><div class="kick">The problem</div><h2>Agents are arriving faster than <b>accountability</b></h2>
<div class="three" style="margin-top:20px">
<div class="card"><h3>Who is this agent?</h3><p>Agents act with no portable identity and no track record. A buyer can't tell a proven agent from a fresh one.</p></div>
<div class="card"><h3>Who paid for what?</h3><p>Agent-to-agent payments happen off the record, so nobody can audit what work was bought or delivered.</p></div>
<div class="card"><h3>Who decides?</h3><p>Today an agent with a key can do anything. People need a hard stop on the actions that matter, without seed phrases.</p></div>
</div>
<p class="lead" style="margin-top:22px">Gartner predicts 40% of enterprise apps will include task-specific agents by 2026, and KPMG's Q3 2026 AI Pulse found 49% of leaders have defined high-risk uses where autonomous agent decisions are not allowed.</p>
<p class="note">Sources as cited in the original deck: Gartner via PEX Network (2025); KPMG LLP (US), Q3 2026 AI Pulse Survey.</p></section>"""

MONAD = """
<section id="monad"><div class="kick">Why Monad</div><h2>The design needs a <b>fast EVM with native P-256</b></h2>
<div class="three" style="margin-top:20px">
<div class="card"><h3>Native P-256</h3><p>StewardCouncil verifies passkey-curve signatures through Monad's P-256 precompile (RIP-7212 at <code>0x0100</code>), so stewards approve with a device key instead of guarding a seed phrase.</p></div>
<div class="card"><h3>A payment per task</h3><p>x402 means one onchain settlement per piece of agent work. Monad's throughput and low fees make paying for each lesson plan or check practical.</p></div>
<div class="card"><h3>Shared agent identity</h3><p>The canonical ERC-8004 identity and reputation registries already live on Monad, so our agents' reputation is readable by every other project there.</p></div>
</div>
<p class="note" style="margin-top:16px">Plain Solidity with OpenZeppelin, tested with Foundry: 15/15 contract tests pass.</p></section>"""


def problem_what_monad_live(c):
    dep, con, E, addr, tx = c["dep"], c["con"], c["E"], c["addr"], c["tx"]
    what = f"""
<section id="what"><div class="kick">What we built</div><h2>One loop: <b>identity → payment → receipt → reputation → people sign off</b></h2>
<div class="flow"><span>ERC-8004 identity</span><i>→</i><span>x402 payment (EIP-3009 tOMEGA)</span><i>→</i><span>spending-cap check</span><i>→</i><span>hash-chained receipt</span><i>→</i><span>ERC-8004 reputation</span><i>→</i><span>2-of-3 stewards mint credential</span></div>
<div class="two" style="margin-top:24px">
<div class="card"><h3>Agents operate</h3><ul><li>Every agent has a wallet and a registered ERC-8004 identity whose card lives in the public repo.</li><li>Agents buy lesson plans, evidence checks and reviews from each other, paid by x402.</li><li>The hub enforces caps: {E(dep['caps']['perTx'])} per payment, {E(dep['caps']['daily'])} per day.</li><li>Each payment extends a tamper-evident receipt chain, and the buyer rates the seller against that receipt.</li></ul></div>
<div class="card"><h3>People govern</h3><ul><li>Registering agents, minting credentials and pausing all go through the StewardCouncil.</li><li>2 of 3 stewards sign with P-256 keys, the curve passkeys use. No seed phrase.</li><li>The council keeps its own hash-chained governance log (nonce now {con['councilNonce']}).</li><li>Credentials are non-transferable: a certificate stays with the person who earned it.</li></ul></div>
</div></section>"""
    rows = "".join(f"<tr><td><b>{n}</b><br><span class=note>{E(d)}</span></td><td>{addr(dep[n], True)}</td><td>{tx(dep[n + '_tx'])}</td></tr>" for n, d in CONTRACTS)
    rows += "".join(f"<tr><td><b>ERC-8004 {k.title()} Registry</b><br><span class=note>canonical, shared by every agent project on Monad</span></td>"
                    f"<td>{addr(v, True)}</td><td class=note>pre-existing</td></tr>" for k, v in dep["erc8004"].items())
    live = f"""
<section id="live"><div class="kick">Proof</div><h2>Live on <b>Monad testnet</b></h2>
<p class="lead">Four contracts deployed by us, plus the canonical ERC-8004 registries. Every address and transaction opens on the explorer.</p>
<table><tr><th>Contract</th><th>Address</th><th>Deploy tx</th></tr>{rows}</table></section>"""
    return PROBLEM + what + MONAD + live
