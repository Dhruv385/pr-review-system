import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService as NestJwtService } from '@nestjs/jwt';

export interface JwtPayload {
    sub: string;
    email: string;
    iat?: number;
    exp?: number;
}

@Injectable()
export class JwtService {
    private readonly secret: string;

    constructor(
        private readonly jwtService: NestJwtService,
        config: ConfigService,
    ) {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret) {
            throw new Error('JWT_SECRET is not set');
        }
        this.secret = secret;
    }

    /** Signs an access token for an authenticated user (register/login). */
    sign(userId: string, email: string): string {
        const payload: JwtPayload = {
            sub: userId,
            email,
        };

        return this.jwtService.sign(payload, {
            expiresIn: '24h',
            secret: this.secret,
        });
    }

    /**
     * Verify and decode a JWT token.
     */
    verifyToken(token: string): JwtPayload | null {
        try {
            return this.jwtService.verify<JwtPayload>(token, {
                secret: this.secret,
            });
        } catch {
            return null;
        }
    }
}
