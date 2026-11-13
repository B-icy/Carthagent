---
description: Deliver a small edit through the Ship fast lane with fresh executable evidence
argument-hint: "<task>"
---
Deliver this small edit with executable evidence: $@

This is a small edit, so use the fast lane, not delivery_plan: read only what you need, then call tools.carthagent.delivery_small({ action: "start", goal, files, checks }) with the goal, the 1-3 files you will change and at least one check of kind "test" or "runtime" that proves the edit (an existing test, or a node one-liner that exits non-zero if the edit is missing; "static" checks alone are rejected). Make the edit with edit/write, then call delivery_small action="finish" once with a short change summary, and stop. If it turns out bigger or riskier than it looked (more files, behaviour changes, sensitive code), use delivery_plan and the full flow instead.
