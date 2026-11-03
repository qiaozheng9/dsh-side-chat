# Attribution

The side-conversation core, host transport, transcript parsing, and selected tests were extracted from dsh-better-sidebar 0.29.0 (MIT), commit 049db64 and its dev integration. The upstream LICENSE is preserved. This standalone package includes no dependency on that package or its checkout.

Starting with 0.2.0, runtime chat rendering, streaming and ordinary Session forks are provided by the installed DSH host through its public services and component Factory. The historical 0.1.x custom implementations remain in source for regression reference; the runtime entrypoints do not load them.

ZIP generation uses fflate 0.8.2, Copyright (c) 2023 Arjun Barrett, MIT licensed. Its license is included in the installed dependency.
