// The assistant's AI fallback (backend services/work/ai_assistant.py): a question the phrase
// rules don't understand is answered by a language model reading the app's data as the asker.
import { request } from '../api';

export type AiTurn = { role: 'user' | 'assistant'; content: string };

export const aiApi = {
  ask: (workspaceId: string, question: string, history: AiTurn[]) =>
    request<{ answer: string }>('POST', `/workspaces/${workspaceId}/assistant/ask`, { question, history }),
};
