import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { OpenClaudeModule } from '../openclaude/openclaude.module';
import { AdminModule } from '../admin/admin.module';
import { ProvidersModule } from '../providers/providers.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { McpModule } from '../mcp/mcp.module';

@Module({
  imports: [
    OpenClaudeModule,
    AdminModule,
    ProvidersModule,
    PermissionsModule,
    McpModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
