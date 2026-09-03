import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from './jwt.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
    constructor(private readonly jwtService: JwtService) { }

    canActivate(context: ExecutionContext): boolean {
        const req = context.switchToHttp().getRequest();
        const authHeader: string | undefined = req.headers['authorization'];
        const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;

        if (!token) {
            throw new UnauthorizedException('Missing bearer token.');
        }

        const payload = this.jwtService.verifyToken(token);
        if (!payload) {
            throw new UnauthorizedException('Invalid or expired token.');
        }

        req.user = { id: payload.sub, email: payload.email };
        return true;
    }
}
