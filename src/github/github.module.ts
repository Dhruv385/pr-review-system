import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { GithubAuthService } from './github-auth.service';
import { GithubApiClient } from './github-api.client';
import { GithubService } from './github.service';
import { CryptoService } from '@/common/services/crypto.service';
import { PrismaService } from '@/database/prisma.service';

@Module({
  imports: [HttpModule],
  providers: [PrismaService, GithubAuthService, GithubApiClient, GithubService, CryptoService],
  exports: [GithubAuthService, GithubService, GithubApiClient, PrismaService],
})
export class GithubModule { }
