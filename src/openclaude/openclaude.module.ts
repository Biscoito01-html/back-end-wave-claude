import { Module } from '@nestjs/common';
import { OpenClaudeHttpService } from './openclaude-http.service';

@Module({
  providers: [OpenClaudeHttpService],
  exports: [OpenClaudeHttpService],
})
export class OpenClaudeModule {}
