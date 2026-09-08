import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-modules/ioredis';
import { EnvModule, EnvService } from '@shared/env';

@Module({
    imports: [
        RedisModule.forRootAsync({
            imports: [EnvModule],
            inject: [EnvService],
            useFactory: (env: EnvService) => ({
                type: 'single',
                url: env.REDIS.URL,
            }),
        }),
    ],
    exports: [RedisModule],
})
export class CommonRedisModule { }
