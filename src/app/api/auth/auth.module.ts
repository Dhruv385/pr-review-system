import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DatabaseModule } from '@shared/database/database.module';
import { PasswordModule } from '@shared/password/password.module';
import { TokenModule } from '@shared/token/token.module';

@Module({
    imports: [
        DatabaseModule,
        PassportModule,
        TokenModule,
        PasswordModule,
        ThrottlerModule.forRoot([{ name: 'auth', ttl: 60_000, limit: 20 }]),
    ],
    controllers: [AuthController],
    providers: [AuthService],
})
export class AuthModule { }
