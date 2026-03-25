export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

export class UserRepository {
  private users: Map<string, User> = new Map();

  create(data: Omit<User, 'id' | 'createdAt'>): User {
    const user: User = {
      id: Math.random().toString(36).slice(2),
      ...data,
      createdAt: new Date(),
    };
    this.users.set(user.id, user);
    return user;
  }

  findById(id: string): User | null {
    return this.users.get(id) ?? null;
  }

  findByEmail(email: string): User | null {
    for (const user of this.users.values()) {
      if (user.email === email) return user;
    }
    return null;
  }

  update(id: string, data: Partial<User>): User | null {
    const user = this.users.get(id);
    if (!user) return null;
    const updated = { ...user, ...data };
    this.users.set(id, updated);
    return updated;
  }
}
