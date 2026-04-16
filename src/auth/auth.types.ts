export interface AuthUser {
  id: string;
  email?: string;
  role: 'user' | 'admin';
}
