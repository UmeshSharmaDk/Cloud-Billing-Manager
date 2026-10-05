---
name: Admin capacity governance
description: Product rules for account invitations and requests for additional user capacity.
---

A capacity request is a quote and a request for review, not a payment or a capacity grant. Do not claim payment succeeded or automatically expand an allowance. Only an explicit superadmin review that sets a sufficient new limit can grant seats; payment-gateway work is deferred.

**Why:** The product owner requires operator review and wants unpaid or pending requests to have no effect on account capacity.

**How to apply:** Preserve this boundary in capacity APIs, dashboards, notification copy, and any future checkout/webhook work.
