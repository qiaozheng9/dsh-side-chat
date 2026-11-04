# Changelog

## 0.2.4

- Fix the brief red `Session reference ... is released` error during side-chat deletion. Synchronously unmount the native SessionProvider and release its reference before the permanent-deletion transaction revokes the session.
- Show the deleting state during cleanup. If deletion genuinely fails, keep the error and reopen the same native session for retry without creating a replacement fork.
- Verify the complete closing interval with DOM-mutation and animation-frame monitoring in the installed Desktop app: empty panel close, native tab close and confirmed close after chatting produce no alerts or reference errors, and still remove session storage and temporary ownership.

## 0.2.3

- Expose `/side` only after the main chat has messages. Empty chats show an unavailable-command message without sending the command to the model; stale side tabs restored into an empty main chat are removed.
- Close untouched and draft-only side chats directly through permanent cleanup. Keep deletion confirmation after a new side message is submitted, counting only activity after the inherited context boundary.
- Show DSH's native DeepSeek mark and a context hint on the empty side page; hide it when the conversation starts while retaining the native composer and transcript.
- Verify both header and native tab close controls, first-message confirmation, draft cleanup, contextual replies and main-chat isolation in the installed Windows Desktop application.

## 0.2.2

- Exclude temporary side chats from the native left conversation list and search without removing the native catalog metadata needed by their composers and tools. Hold list updates during creation to prevent a brief visible row.
- Persist exact temporary ownership and reclaim registered abandoned copies after a window reload or host restart. Remove the ownership registry after the last confirmed deletion.
- Honor the deletion owner's completion receipt and preserve the closed native tab binding through removal, preventing a replacement fork from being created during a remount.
- Verify installed Desktop cleanup of session files, projection caches, workspace references, browser drafts and exclusive attachment objects, while retaining original project files and the main conversation.

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
