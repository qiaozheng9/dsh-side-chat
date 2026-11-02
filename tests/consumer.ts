/** Compile the package's actual published entrypoints, rather than source aliases. */
import { apply, inject, name } from 'dsh-side-chat'
import { apply as clientApply, inject as clientInject } from 'dsh-side-chat/client'
const host: (...args: Parameters<typeof apply>) => void = apply
const client: (...args: Parameters<typeof clientApply>) => void = clientApply
const deps: readonly string[] = [...inject, ...clientInject]
const id: string = name
void host; void client; void deps; void id
