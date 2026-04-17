import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.project.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(userId: string, data: { name: string; description?: string; icon?: string; color?: string }) {
    return this.prisma.project.create({
      data: {
        userId,
        name: data.name,
        description: data.description ?? null,
        icon: data.icon ?? 'folder',
        color: data.color ?? 'blue',
      },
    });
  }

  async update(userId: string, id: string, data: { name?: string; description?: string; icon?: string; color?: string }) {
    await this.assertOwnership(userId, id);
    return this.prisma.project.update({ where: { id }, data });
  }

  async remove(userId: string, id: string) {
    await this.assertOwnership(userId, id);
    await this.prisma.project.delete({ where: { id } });
    return { success: true };
  }

  private async assertOwnership(userId: string, id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.userId !== userId) throw new ForbiddenException('Not your project');
    return project;
  }
}
