import { IsDefined, IsString } from 'class-validator';

export class JwtConfig {
  @IsDefined()
  @IsString()
  SECRET!: string;
}
