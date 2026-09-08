import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-modules/ioredis';

@Module({
    imports: [
        ConfigModule,
        RedisModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
                type: 'single',
                url: config.get<string>('REDIS_URL', 'redis://localhost:6379'),
            }),
        }),
    ],
    exports: [RedisModule],
})
export class CommonRedisModule { }