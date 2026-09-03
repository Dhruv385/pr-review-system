import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { PasswordService } from '@/common/services/password.service';
import { JwtService } from './jwt.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

export interface AuthResult {
  accessToken: string;
  user: {
    id: string;
    email: string;
    platform: string;
    username: string;
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly password: PasswordService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const [existingEmail, existingPlatformIdentity] = await Promise.all([
      this.prisma.user.findUnique({ where: { email: dto.email } }),
      this.prisma.user.findUnique({
        where: { platform_platformUsername: { platform: dto.platform, platformUsername: dto.username } },
      }),
    ]);

    if (existingEmail) {
      throw new ConflictException('An account with this email already exists.');
    }
    if (existingPlatformIdentity) {
      throw new ConflictException(`This ${dto.platform} username is already registered to another account.`);
    }

    const passwordHash = await this.password.hash(dto.password);

    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash,
          platform: dto.platform,
          platformUsername: dto.username,
        },
      });

      return this.toResult(user.id, user.email, user.platform, user.platformUsername);
    } catch (err) {
      // Defense-in-depth against a concurrent registration racing the checks above.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('An account with this email or platform username already exists.');
      }
      throw err;
    }
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    const valid = user ? await this.password.verify(dto.password, user.passwordHash) : false;

    if (!user || !valid) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    return this.toResult(user.id, user.email, user.platform, user.platformUsername);
  }

  private toResult(userId: string, email: string, platform: string, username: string): AuthResult {
    return {
      accessToken: this.jwt.sign(userId, email),
      user: { id: userId, email, platform, username },
    };
  }
}
