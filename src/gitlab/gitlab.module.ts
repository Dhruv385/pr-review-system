import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { GitlabAuthService } from './gitlab-auth.service';
import { GitlabApiClient } from './gitlab-api.client';
import { GitlabService } from './gitlab.service';
import { CryptoService } from '@/common/services/crypto.service';
import { PrismaService } from '@/database/prisma.service';

@Module({
  imports: [HttpModule],
  providers: [PrismaService, GitlabAuthService, GitlabApiClient, GitlabService, CryptoService],
  exports: [GitlabAuthService, GitlabService, PrismaService],
})
export class GitlabModule { }
