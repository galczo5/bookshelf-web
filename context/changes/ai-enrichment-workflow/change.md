---
change_id: ai-enrichment-workflow
title: Multi-agent AI enrichment workflow with per-field retry UI
status: implementing
created: 2026-06-12
updated: 2026-06-13
archived_at: null
---

## Notes

We need to improve AI enrichment feature. Make it more like workflow:

- Main agent collect data about book, avaiable metadata, file name etc
- Main agent spawn an agent to classify in which language available data is
- Then spawn sub agents for each field, remember about series and part fields

Let agents use web search to find necessary informations.

From UI standpoint each field should allow user to send message to agent and agent should try again
