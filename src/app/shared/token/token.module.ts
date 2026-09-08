import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EnvModule, EnvService } from '@shared/env';
import { JwtService } from './jwt.service';

/**
 * Global because JwtAuthGuard (in GuardsModule, also global) depends on
 * JwtService — a global provider that itself depends on a non-global one
 * can fail to resolve when instantiated in a consuming module's context, so
 * both stay global together (mirrors the previous single @Global() AuthModule,
 * which provided JwtService and JwtAuthGuard side by side).
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [EnvModule],
      inject: [EnvService],
      useFactory: (env: EnvService) => ({
        secret: env.JWT.SECRET,
        signOptions: { expiresIn: '24h' },
      }),
    }),
  ],
  providers: [JwtService],
  exports: [JwtService],
})
export class TokenModule {}
