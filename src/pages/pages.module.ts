import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PagesController } from './pages.controller';
import { PagesService } from './pages.service';

@Module({
  imports: [PrismaModule],
  controllers: [PagesController],
  providers: [PagesService],
})
export class PagesModule {}
