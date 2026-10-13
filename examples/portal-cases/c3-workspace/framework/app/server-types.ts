export interface User { id: string; username: string; role: 'member' | 'admin' }
export interface Note { id: string; title: string; content: string; updatedAt: number }
