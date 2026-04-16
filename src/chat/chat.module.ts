import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { OpenClaudeModule } from '../openclaude/openclaude.module';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [OpenClaudeModule, AdminModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
