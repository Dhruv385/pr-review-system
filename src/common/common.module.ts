import { Module } from '@nestjs/common';
import { CryptoService } from './services/crypto.service';

/** Cross-cutting stateless services shared by GithubModule and GitlabModule. */
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CommonModule {}
