import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtService } from './jwt.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { BasicStrategy } from './strategies/basic.strategy';
import { BasicAuthGuard } from './guards/basic-auth.guard';
import { PasswordService } from '@/common/services/password.service';
import { DatabaseModule } from '@/database/database.module';

@Global()
@Module({
    imports: [
        ConfigModule,
        DatabaseModule,
        PassportModule,
        JwtModule.registerAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
                secret: config.getOrThrow<string>('JWT_SECRET'),
                signOptions: { expiresIn: '24h' },
            }),
        }),
        ThrottlerModule.forRoot([{ name: 'auth', ttl: 60_000, limit: 20 }]),
    ],
    controllers: [AuthController],
    providers: [JwtService, JwtAuthGuard, AuthService, PasswordService, BasicStrategy, BasicAuthGuard],
    exports: [JwtService, JwtAuthGuard],
})
export class AuthModule { }
