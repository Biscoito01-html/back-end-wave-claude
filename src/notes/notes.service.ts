import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.contextNote.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  create(userId: string, data: { title: string; content?: string }) {
    return this.prisma.contextNote.create({
      data: {
        userId,
        title: data.title,
        content: data.content ?? '',
      },
    });
  }

  async update(
    userId: string,
    id: string,
    data: { title?: string; content?: string; isActive?: boolean; projectId?: string | null },
  ) {
    await this.assertOwnership(userId, id);
    return this.prisma.contextNote.update({ where: { id }, data });
  }

  async remove(userId: string, id: string) {
    await this.assertOwnership(userId, id);
    await this.prisma.contextNote.delete({ where: { id } });
    return { success: true };
  }

  private async assertOwnership(userId: string, id: string) {
    const note = await this.prisma.contextNote.findUnique({ where: { id } });
    if (!note) throw new NotFoundException('Note not found');
    if (note.userId !== userId) throw new ForbiddenException('Not your note');
    return note;
  }
}
