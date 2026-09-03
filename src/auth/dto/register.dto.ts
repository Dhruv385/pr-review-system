import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { Platform } from '@/common/interfaces/pr-review.interfaces';

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'StrongPassw0rd!', minLength: 8, description: 'Minimum 8 characters' })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @ApiProperty({ enum: Platform, example: Platform.GITHUB })
  @IsEnum(Platform)
  platform!: Platform;

  @ApiProperty({ example: 'octocat', description: 'Your username on the selected platform' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  username!: string;
}
