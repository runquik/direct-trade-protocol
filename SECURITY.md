# Security

Direct Trade Protocol is unreleased reference software. It has had internal adversarial review
but no independent security audit. Do not use it to protect real business data, money or
identities.

## Reporting a vulnerability

Please report privately through GitHub: open the repository's **Security** tab and choose
**Report a vulnerability**. Do not open a public issue for a suspected vulnerability.

Useful reports include the affected layer and file, a minimal reproduction, and what an
attacker gains. Of particular interest: signature, canonicalization or encoding confusion;
authority or grant bypass; replay or idempotency failures; a revoked key or member retaining
access; cross-organization data exposure; and resource exhaustion in a reference host.

There is no bounty programme. Good-faith research against your own local instance is welcome;
please do not test against infrastructure you do not own.
