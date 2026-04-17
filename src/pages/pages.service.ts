import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PagesService {
  constructor(private readonly prisma: PrismaService) {}

  listByUser(userId: string) {
    return this.prisma.page.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        projectId: true,
        createdAt: true,
        updatedAt: true,
        project: { select: { id: true, name: true } },
      },
    });
  }

  listByProject(userId: string, projectId: string) {
    return this.prisma.page.findMany({
      where: { userId, projectId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        projectId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async getOne(userId: string, id: string) {
    const page = await this.prisma.page.findUnique({ where: { id } });
    if (!page) throw new NotFoundException('Página não encontrada');
    if (page.userId !== userId) throw new ForbiddenException('Sem permissão');
    return page;
  }

  create(userId: string, data: { title: string; htmlContent: string; projectId?: string | null }) {
    return this.prisma.page.create({
      data: {
        userId,
        title: data.title,
        htmlContent: data.htmlContent,
        projectId: data.projectId ?? null,
      },
    });
  }

  async update(userId: string, id: string, data: { title?: string; htmlContent?: string; projectId?: string | null }) {
    await this.assertOwnership(userId, id);
    return this.prisma.page.update({ where: { id }, data });
  }

  async remove(userId: string, id: string) {
    await this.assertOwnership(userId, id);
    await this.prisma.page.delete({ where: { id } });
    return { success: true };
  }

  private async assertOwnership(userId: string, id: string) {
    const page = await this.prisma.page.findUnique({ where: { id } });
    if (!page) throw new NotFoundException('Página não encontrada');
    if (page.userId !== userId) throw new ForbiddenException('Sem permissão');
    return page;
  }
}
