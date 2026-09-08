import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBasicAuth } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { JwtService } from '@shared/token/jwt.service';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { BasicAuthGuard } from '@guards/basic';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
    constructor(
        private readonly jwtService: JwtService,
        private readonly authService: AuthService,
    ) { }

    @ApiBasicAuth()
    @ApiOperation({
        summary: 'Register a new account and receive an access token',
        description:
            'Requires the shared client Basic Auth credential (in addition to the account fields below) — ' +
            'this is a gate against anonymous bots, separate from the per-user JWT this endpoint issues. ' +
            'Email must be unique; platform + username together must also be unique (one account per platform identity).',
    })
    @ApiResponse({ status: 201, description: 'Account created; access token returned' })
    @ApiResponse({ status: 400, description: 'Validation failed (e.g. invalid email, password under 8 characters)' })
    @ApiResponse({ status: 401, description: 'Missing or invalid Basic Auth client credential' })
    @ApiResponse({ status: 409, description: 'This email or platform username is already registered to another account' })
    @ApiResponse({ status: 429, description: 'Too many registration attempts — try again shortly' })
    @Throttle({ auth: { limit: 5, ttl: 60_000 } })
    @UseGuards(ThrottlerGuard, BasicAuthGuard)
    @Post('register')
    async register(@Body() dto: RegisterDto) {
        return this.authService.register(dto);
    }

    @ApiBasicAuth()
    @ApiOperation({
        summary: 'Log in with email and password to receive an access token',
        description: 'Requires the shared client Basic Auth credential in addition to your email/password.',
    })
    @ApiResponse({ status: 200, description: 'Access token returned' })
    @ApiResponse({ status: 400, description: 'Validation failed (missing email or password)' })
    @ApiResponse({ status: 401, description: 'Invalid email/password, or missing/invalid Basic Auth client credential' })
    @ApiResponse({ status: 429, description: 'Too many login attempts — try again shortly' })
    @Throttle({ auth: { limit: 10, ttl: 60_000 } })
    @UseGuards(ThrottlerGuard, BasicAuthGuard)
    @HttpCode(200)
    @Post('login')
    async login(@Body() dto: LoginDto) {
        return this.authService.login(dto);
    }

    /**
     * Verify a JWT token (for debugging).
     */
    @ApiOperation({ summary: 'Verify and decode a JWT token' })
    @ApiQuery({ name: 'token', description: 'JWT token to verify' })
    @ApiResponse({ status: 200, description: 'Token is valid and decoded' })
    @ApiResponse({ status: 400, description: 'Token is invalid' })
    @Get('verify-token')
    verifyToken(@Query('token') token: string) {
        if (!token) {
            return { valid: false, error: 'No token provided' };
        }

        const decoded = this.jwtService.verifyToken(token);
        if (!decoded) {
            return { valid: false, error: 'Invalid or expired token' };
        }

        return { valid: true, decoded };
    }
}
