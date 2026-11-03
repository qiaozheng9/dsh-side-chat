# Changelog

## 0.2.1

- Start side chats with an empty transcript while preserving the forked main-chat context for the model. Display only messages created after opening.
- Apply the same display boundary to native chat groups, turn navigation, history paging and trajectory records. Preserve native streaming, timestamps, token usage, tools and controls.
- Verify the installed Windows Desktop plugin: contextual follow-ups, 18 streaming updates, independent copies, model/permission isolation, attachments, plan approval, ZIP export and confirmed deletion. The stable source session file remains byte-for-byte unchanged.

## 0.2.0

- Replace the custom transcript and composer with DSH's official SessionProvider and Conversation content Factory, including native timestamps, token usage, message actions, controls and command menus.
- Create an ordinary independent Session using DSH's native fork. Preserve copied history and applicable instructions without injecting a side-conversation boundary.
- Use the native Session streaming transport instead of side-chat invalidation sockets and polling.
- Keep confirmed permanent deletion through dsh-delete-session and restrict lifecycle operations to plugin-created temporary identities.
- Use native log export for the copied session, including inherited history. This replaces 0.1.x's side-only export format.

## 0.1.12

- Answer normally without announcing side-chat boundaries; update guidance once for existing temporary chats on their next message.
- Match native response states: analysis, response streaming, tools, approvals and questions; show completion duration with expandable process history, and distinct stopped/failed outcomes.
- Prevent stale live frames or queued messages from keeping a completed response in a thinking state.

## 0.1.11

- Prepare the standalone plugin for the community marketplace with public repository metadata, curated screenshots and a prebuilt GitHub Release package.
- Declare the verified complete environment: Windows DSH Desktop 0.2.1-rc.5 with dsh-delete-session installed for permanent close cleanup.
- Retain the 0.1.10 runtime behavior: independent contextual side chats, native model/permission controls, goals, plan review, attachments, compaction, log export and confirmed deletion.
