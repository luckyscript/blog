# Photography backend

Vendored from `luckyscript/jianshan-portfolio`, revision `c4bfea1af7bf7870a321f4af7fc45eb413bae642`, with the live HMAC bridge and cloud deployment changes. The main blog owns the public photography pages and authenticated admin shell.

The service uses its own pinned dependencies, Node.js 22, the existing MySQL/RDS database, and private local media storage on ECS. Configuration belongs in `/etc/rain-blog/photography-service.env`; never place credentials, photos, databases or backups in this directory.

Run `npm ci` and `npm test` here. The deployment units, migration procedure and recovery guidance are documented in `../../docs/photography-integration.md`. The upstream browser assets are retained for its native renderer and regression tests; the production blog serves its own themed interface.
