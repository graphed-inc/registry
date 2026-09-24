# Outbound agent

A reply agent for [Instantly](https://instantly.ai) cold email.

The client setup is one credential: an Instantly API v2 key. Models run
through the Graphed Tools OpenRouter proxy, so there is no OpenRouter,
Anthropic, or OpenAI key to collect.

## What you get

- **Campaigns** synced from Instantly. Each row is one Instantly campaign.
- **A playbook document** per campaign — markdown the agent treats as the
  only source of truth for the offer, the voice, and the limits.
- **A reply mode** per campaign:
  - **Off** — the inbox job ignores the campaign.
  - **Draft replies** — the agent writes the reply and stores it on the
    campaign. Nothing is sent.
  - **Auto-send** — the agent sends the reply from the same Instantly inbox.
- **Test before save.** The editor can send a fake inbound message through
  the same prompt the live job uses. The test reads the document currently
  in the editor, not the saved copy, and it never calls Instantly.

New campaigns arrive in **Off** with a starter playbook. The starter is
marked incomplete, and the inbox job will not draft or send until that
marker is removed. Testing still works on the starter, so the playbook
can be tried before it goes live.

## Dashboard

`/outbound` is a table of Instantly campaigns with top-line stats. Open a
campaign for three tabs:

- **Unibox** — threads, a reply box (save a draft or send), and
  **Configure auto-response** for Off, Draft replies, or Auto-send.
- **Playbook testing** — the document and a fake-message test. The test
  uses the editor contents, does not save, and does not call Instantly.
- **Leads** — that campaign’s Instantly leads.

## Job

`outbound-replies` polls Instantly every 10 minutes for campaigns whose
saved mode is Draft or Auto-send.
