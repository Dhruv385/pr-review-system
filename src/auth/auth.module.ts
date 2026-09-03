import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtService } from './jwt.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordService } from '@/common/services/password.service';
import { DatabaseModule } from '@/database/database.module';

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
    throw new Error('JWT_SECRET is not set');
}

@Global()
@Module({
    imports: [
        DatabaseModule,
        JwtModule.register({
            secret: jwtSecret,
            signOptions: { expiresIn: '24h' },
        }),
        ThrottlerModule.forRoot([{ name: 'auth', ttl: 60_000, limit: 20 }]),
    ],
    controllers: [AuthController],
    providers: [JwtService, JwtAuthGuard, AuthService, PasswordService],
    exports: [JwtService, JwtAuthGuard],
})
export class AuthModule { }
