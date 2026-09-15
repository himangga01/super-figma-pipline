import { canonicalFileIdentityHash, type FileIdentity } from '@sfp/shared';
import { ref } from 'vue';

import type { RelayClient, RelayHelloSnapshot } from '../relay/client.js';
import { postToSandbox } from '../sandbox/messaging.js';

export const useDocumentBinding = (input: {
  client: RelayClient;
  fileName(): string | null;
  transition(identity: FileIdentity, nonce: string): Promise<RelayHelloSnapshot>;
}) => {
  const url = ref(''),
    status = ref<'idle' | 'waiting-approval' | 'reconnecting' | 'connected' | 'error'>('idle');
  const error = ref<string | null>(null);
  const persistent = ref(false);
  let active = false,
    disposed = false;
  const bind = async (offeredKey?: string, readOnly?: boolean): Promise<void> => {
    if (active || disposed) return;
    active = true;
    error.value = null;
    try {
      if (offeredKey !== undefined) url.value = `https://www.figma.com/design/${offeredKey}`;
      if (readOnly !== undefined) persistent.value = !readOnly;
      const parsed = new URL(url.value);
      const match = /^\/(?:design|file|proto)\/([A-Za-z0-9]{10,128})(?:\/[^/]*)?\/?$/u.exec(
        parsed.pathname,
      );
      if (
        parsed.protocol !== 'https:' ||
        !['figma.com', 'www.figma.com'].includes(parsed.hostname) ||
        parsed.username ||
        parsed.password ||
        parsed.port ||
        match === null
      )
        throw new Error('FIGMA_URL_INVALID');
      const fileKey = match[1]!,
        fileName = input.fileName();
      if (fileName === null) throw new Error('PAIR_CONTEXT_REQUIRED');
      status.value = 'waiting-approval';
      const result = await input.client.requestDocumentBinding({
        fileKey,
        expectedFileName: fileName,
        readOnly: !persistent.value,
      });
      if (disposed) return;
      if (result.readOnly === persistent.value) throw new Error('IDENTITY_BINDING_MODE_MISMATCH');
      if (
        result.fileKeyHash !== canonicalFileIdentityHash({ kind: 'figma-file-key', value: fileKey })
      )
        throw new Error('IDENTITY_BINDING_INVALID');
      if (result.readOnly) {
        status.value = 'connected';
        return;
      }
      if (
        result.fileIdentity.kind !== 'document-plugin-uuid' ||
        result.ticket === null ||
        result.publishNonce === null
      )
        throw new Error('IDENTITY_BINDING_INVALID');
      status.value = 'reconnecting';
      const hello = await input.transition(result.fileIdentity, result.publishNonce);
      if (disposed) return;
      await input.client.disconnect({ forgetCredential: true });
      await input.client.connectWithTicket(result.ticket, hello);
      postToSandbox({ tag: '@sfp/identity-authenticated', nonce: result.publishNonce });
      status.value = 'connected';
    } catch (cause) {
      if (!disposed) {
        status.value = 'error';
        error.value = cause instanceof Error ? cause.message : 'IDENTITY_BINDING_FAILED';
      }
    } finally {
      active = false;
    }
  };
  input.client.setBindingOfferHandler((key, readOnly) => {
    void bind(key, readOnly);
  });
  return {
    url,
    persistent,
    status,
    error,
    bind,
    dispose: () => {
      disposed = true;
      input.client.setBindingOfferHandler(null);
    },
  };
};
