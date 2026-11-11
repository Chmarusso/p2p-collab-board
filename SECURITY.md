# Security policy

OpenCollab's promises are that only a board's members can read it and that nobody can forge
or rewrite someone else's changes. If you find a way to break either, or any other security
problem, please tell us privately first.

## Reporting a vulnerability

- Use GitHub's [private vulnerability reporting](https://github.com/Chmarusso/p2p-collab-board/security/advisories/new),
  or email **CONTACT_EMAIL**.
- Include the app and version, what an attacker can do, and steps to reproduce.
- Please don't open a public issue or publish details until a fix is out.

We aim to reply within a week and to tell you when the fix ships. Reports about the
Holepunch building blocks (Hypercore, Hyperswarm, Pear, Bare) are welcome too; we'll pass
them on to Holepunch.

## Not a security issue

- Someone who holds a board's invite link can read the board. That is how sharing works;
  removing a member stops their changes from counting but can't take back what they saw.
- Peers you connect to, and the network nodes that help set up connections, can see your IP
  address. See the [privacy policy](PRIVACY.md).

Abuse by other users (illegal content, harassment) is not a vulnerability; see
[Reporting abuse](TERMS.md#reporting-abuse).
